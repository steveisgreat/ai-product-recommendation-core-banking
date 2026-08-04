import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  evaluateEligibility,
  isAtLeastBand,
  isAtLeastIncome,
  UnknownRuleKeyError,
  _PREDICATE_MAP_KEYS,
} from '@/lib/eligibility-engine'
import { RULE_KEYS } from '@/lib/eligibility-rules'
import type { CustomerSignals, Product, BalanceBand, IncomeBand } from '@/lib/db/types'

// Helper: build a minimal valid CustomerSignals object
function makeSignals(overrides: Partial<CustomerSignals> = {}): CustomerSignals {
  return {
    account_count: 1,
    account_types: [],
    total_balance_band: '5K_25K',
    avg_monthly_inflow_band: '1K_5K',
    transaction_pattern_flags: [],
    tenure_months: 12,
    household_income_band: 'MIDDLE',
    external_account_types: [],
    existing_product_ids: [],
    ...overrides,
  }
}

// Helper: build a minimal valid Product with specified rules
function makeProduct(
  id: string,
  rules: { rule_key: string; description: string }[]
): Product {
  return {
    id,
    name: `Product ${id}`,
    account_type: 'CHECKING',
    requires_deposit: true,
    rate: null,
    eligibility_rules: rules,
    description: 'Test product',
  }
}

// ─── Unit tests: ordinal comparisons ───────────────────────────────────────────

describe('Eligibility Engine - Ordinal Comparisons', () => {
  it('customer in 25K_100K band passes MIN_BALANCE_BAND_5K_25K (ordinal >=)', () => {
    const signals = makeSignals({ total_balance_band: '25K_100K' })
    const product = makeProduct('p1', [
      { rule_key: RULE_KEYS.MIN_BALANCE_BAND_5K_25K, description: 'Balance >= 5K_25K' },
    ])
    const result = evaluateEligibility(signals, [product])
    expect(result.eligible).toContain(product)
    expect(result.audit[0].passed).toBe(true)
  })

  it('customer in HIGH income band passes MIN_INCOME_BAND_MIDDLE (ordinal >=)', () => {
    const signals = makeSignals({ household_income_band: 'HIGH' })
    const product = makeProduct('p2', [
      { rule_key: RULE_KEYS.MIN_INCOME_BAND_MIDDLE, description: 'Income >= MIDDLE' },
    ])
    const result = evaluateEligibility(signals, [product])
    expect(result.eligible).toContain(product)
    expect(result.audit[0].passed).toBe(true)
  })

  it('customer in 1K_5K band fails MIN_BALANCE_BAND_5K_25K (lower bound enforced)', () => {
    const signals = makeSignals({ total_balance_band: '1K_5K' })
    const product = makeProduct('p3', [
      { rule_key: RULE_KEYS.MIN_BALANCE_BAND_5K_25K, description: 'Balance >= 5K_25K' },
    ])
    const result = evaluateEligibility(signals, [product])
    expect(result.eligible).not.toContain(product)
    expect(result.audit[0].passed).toBe(false)
  })

  it('isAtLeastBand returns true for equal band', () => {
    expect(isAtLeastBand('5K_25K', '5K_25K')).toBe(true)
  })

  it('isAtLeastBand returns false for lower band', () => {
    expect(isAtLeastBand('UNDER_1K', '1K_5K')).toBe(false)
  })

  it('isAtLeastIncome returns true for equal band', () => {
    expect(isAtLeastIncome('MIDDLE', 'MIDDLE')).toBe(true)
  })

  it('isAtLeastIncome returns false for lower band', () => {
    expect(isAtLeastIncome('LOW', 'MIDDLE')).toBe(false)
  })
})

// ─── Contract coverage tests ───────────────────────────────────────────────────

describe('Eligibility Engine - Contract Coverage', () => {
  it('throws UnknownRuleKeyError for unrecognised rule_key', () => {
    const signals = makeSignals()
    const product = makeProduct('p-bad', [
      { rule_key: 'completely_fake_rule', description: 'Does not exist' },
    ])
    expect(() => evaluateEligibility(signals, [product])).toThrow(UnknownRuleKeyError)
    expect(() => evaluateEligibility(signals, [product])).toThrow(
      'Unknown rule_key encountered: "completely_fake_rule"'
    )
  })

  it('every RULE_KEYS value has a corresponding predicate in the map', () => {
    const allRuleValues = Object.values(RULE_KEYS)
    for (const ruleValue of allRuleValues) {
      expect(
        _PREDICATE_MAP_KEYS,
        `Missing predicate for rule_key: "${ruleValue}"`
      ).toContain(ruleValue)
    }
  })
})

// ─── Property-based tests ──────────────────────────────────────────────────────

// Arbitrary CustomerSignals generator
const arbitrarySignals: fc.Arbitrary<CustomerSignals> = fc.record({
  account_count: fc.nat({ max: 10 }),
  account_types: fc.subarray(['CHECKING', 'SAVINGS', 'CD', 'MONEY_MARKET', 'CREDIT_CARD', 'HELOC', 'OVERDRAFT']),
  total_balance_band: fc.constantFrom<BalanceBand>('UNDER_1K', '1K_5K', '5K_25K', '25K_100K', 'OVER_100K'),
  avg_monthly_inflow_band: fc.constantFrom<BalanceBand>('UNDER_1K', '1K_5K', '5K_25K', '25K_100K', 'OVER_100K'),
  transaction_pattern_flags: fc.subarray(['RECURRING_DIRECT_DEPOSIT', 'OVERDRAFT_LAST_90D']),
  tenure_months: fc.nat({ max: 120 }),
  household_income_band: fc.constantFrom<IncomeBand>('LOW', 'LOWER_MIDDLE', 'MIDDLE', 'UPPER_MIDDLE', 'HIGH'),
  external_account_types: fc.subarray(['CHECKING', 'SAVINGS', 'BROKERAGE', 'INVESTMENT']),
  existing_product_ids: fc.array(fc.uuid(), { maxLength: 5 }),
})

describe('Eligibility Engine - Property-Based Tests', () => {
  /**
   * **Validates: Requirements 2.1**
   * Property 1: If a product has a "no_existing_X" rule for an account type,
   * and that account type is in the customer's account_types, the product is never eligible.
   */
  it('product with no_existing rule fails when customer holds that account type', () => {
    // Map of no_existing rules to account types they check
    const noExistingRuleMap: { rule_key: string; account_type: string }[] = [
      { rule_key: RULE_KEYS.NO_EXISTING_CHECKING, account_type: 'CHECKING' },
      { rule_key: RULE_KEYS.NO_EXISTING_SAVINGS, account_type: 'SAVINGS' },
      { rule_key: RULE_KEYS.NO_EXISTING_CD, account_type: 'CD' },
      { rule_key: RULE_KEYS.NO_EXISTING_MMA, account_type: 'MONEY_MARKET' },
      { rule_key: RULE_KEYS.NO_EXISTING_CREDIT_CARD, account_type: 'CREDIT_CARD' },
      { rule_key: RULE_KEYS.NO_EXISTING_HELOC, account_type: 'HELOC' },
      { rule_key: RULE_KEYS.NO_EXISTING_OVERDRAFT, account_type: 'OVERDRAFT' },
    ]

    const arbitraryRuleAndSignals = fc.record({
      signals: arbitrarySignals,
      ruleIndex: fc.nat({ max: noExistingRuleMap.length - 1 }),
    })

    fc.assert(
      fc.property(arbitraryRuleAndSignals, ({ signals, ruleIndex }) => {
        const { rule_key, account_type } = noExistingRuleMap[ruleIndex]
        // Force customer to hold this account type
        const modifiedSignals: CustomerSignals = {
          ...signals,
          account_types: [...new Set([...signals.account_types, account_type])],
        }
        const product = makeProduct('test-product', [
          { rule_key, description: `No existing ${account_type}` },
        ])
        const result = evaluateEligibility(modifiedSignals, [product])
        return !result.eligible.some((p) => p.id === product.id)
      }),
      { numRuns: 100 }
    )
  })

  /**
   * **Validates: Requirements 2.1**
   * Property 2: Customer with balance_band = UNDER_1K is never eligible for products
   * requiring MIN_BALANCE_BAND_5K_25K or MIN_BALANCE_BAND_25K_100K.
   */
  it('customer with UNDER_1K balance is never eligible for CD, MMA, or HELOC', () => {
    fc.assert(
      fc.property(arbitrarySignals, (baseSignals) => {
        const signals: CustomerSignals = { ...baseSignals, total_balance_band: 'UNDER_1K' as BalanceBand }

        const cdProduct = makeProduct('cd', [
          { rule_key: RULE_KEYS.MIN_BALANCE_BAND_5K_25K, description: 'Balance >= 5K_25K' },
        ])
        const mmaProduct = makeProduct('mma', [
          { rule_key: RULE_KEYS.MIN_BALANCE_BAND_25K_100K, description: 'Balance >= 25K_100K' },
        ])
        const helocProduct = makeProduct('heloc', [
          { rule_key: RULE_KEYS.MIN_BALANCE_BAND_25K_100K, description: 'Balance >= 25K_100K' },
        ])

        const result = evaluateEligibility(signals, [cdProduct, mmaProduct, helocProduct])
        return result.eligible.length === 0
      }),
      { numRuns: 100 }
    )
  })

  /**
   * **Validates: Requirements 2.6**
   * Property 3: audit array always has exactly one entry per product per rule evaluated.
   */
  it('audit has exactly one entry per product per rule', () => {
    fc.assert(
      fc.property(arbitrarySignals, (signals) => {
        const product1 = makeProduct('p1', [
          { rule_key: RULE_KEYS.MIN_TENURE_MONTHS_3, description: 'Tenure >= 3 months' },
          { rule_key: RULE_KEYS.NO_EXISTING_CHECKING, description: 'No checking' },
        ])
        const product2 = makeProduct('p2', [
          { rule_key: RULE_KEYS.HAS_EXTERNAL_ACCOUNT, description: 'Has external account' },
        ])
        const products = [product1, product2]

        const result = evaluateEligibility(signals, products)

        // Total rules: product1 has 2 rules, product2 has 1 rule = 3 total
        const expectedAuditCount = products.reduce(
          (sum, p) => sum + p.eligibility_rules.length,
          0
        )
        return result.audit.length === expectedAuditCount
      }),
      { numRuns: 100 }
    )
  })

  /**
   * **Validates: Requirements 2.1**
   * Property 4: eligible is always a subset of the input products array.
   */
  it('eligible is always a subset of input products', () => {
    fc.assert(
      fc.property(arbitrarySignals, (signals) => {
        const products = [
          makeProduct('p1', [
            { rule_key: RULE_KEYS.MIN_TENURE_MONTHS_3, description: 'Tenure >= 3' },
          ]),
          makeProduct('p2', [
            { rule_key: RULE_KEYS.NO_EXISTING_CHECKING, description: 'No checking' },
          ]),
          makeProduct('p3', [
            { rule_key: RULE_KEYS.MIN_BALANCE_BAND_5K_25K, description: 'Balance >= 5K_25K' },
            { rule_key: RULE_KEYS.MIN_INCOME_BAND_MIDDLE, description: 'Income >= MIDDLE' },
          ]),
        ]

        const result = evaluateEligibility(signals, products)
        const productIds = products.map((p) => p.id)
        return result.eligible.every((p) => productIds.includes(p.id))
      }),
      { numRuns: 100 }
    )
  })
})
