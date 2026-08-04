import { RULE_KEYS } from '@/lib/eligibility-rules'
import type { CustomerSignals, Product, BalanceBand, IncomeBand, EligibilityRule } from '@/lib/db/types'

// Ordinal band ordering for >= comparisons
export const BALANCE_BAND_ORDER: BalanceBand[] = ['UNDER_1K', '1K_5K', '5K_25K', '25K_100K', 'OVER_100K']
export const INCOME_BAND_ORDER: IncomeBand[] = ['LOW', 'LOWER_MIDDLE', 'MIDDLE', 'UPPER_MIDDLE', 'HIGH']

// Ordinal comparison helpers
export function isAtLeastBand(actual: BalanceBand, minimum: BalanceBand): boolean {
  return BALANCE_BAND_ORDER.indexOf(actual) >= BALANCE_BAND_ORDER.indexOf(minimum)
}

export function isAtLeastIncome(actual: IncomeBand, minimum: IncomeBand): boolean {
  return INCOME_BAND_ORDER.indexOf(actual) >= INCOME_BAND_ORDER.indexOf(minimum)
}

// Return types
export interface AuditRecord {
  product_id: string
  rule_key: string
  description: string
  passed: boolean
  actual_value: string | number | boolean
}

export interface EligibilityResult {
  eligible: Product[]
  audit: AuditRecord[]
}

// Custom error for unknown rule keys
export class UnknownRuleKeyError extends Error {
  constructor(ruleKey: string) {
    super(`Unknown rule_key encountered: "${ruleKey}". Add a predicate for this rule to the eligibility engine.`)
    this.name = 'UnknownRuleKeyError'
  }
}

// Predicate types
type PredicateResult = { passed: boolean; actual_value: string | number | boolean }
type RulePredicate = (signals: CustomerSignals) => PredicateResult

// Predicate map keyed on RULE_KEYS values
const PREDICATE_MAP: Record<string, RulePredicate> = {
  [RULE_KEYS.NO_EXISTING_CHECKING]: (s) => {
    const hasChecking = s.account_types.includes('CHECKING')
    return { passed: !hasChecking, actual_value: hasChecking }
  },
  [RULE_KEYS.NO_EXISTING_SAVINGS]: (s) => {
    const hasSavings = s.account_types.includes('SAVINGS')
    return { passed: !hasSavings, actual_value: hasSavings }
  },
  [RULE_KEYS.NO_EXISTING_CD]: (s) => {
    const hasCD = s.account_types.includes('CD')
    return { passed: !hasCD, actual_value: hasCD }
  },
  [RULE_KEYS.NO_EXISTING_MMA]: (s) => {
    const hasMMA = s.account_types.includes('MONEY_MARKET')
    return { passed: !hasMMA, actual_value: hasMMA }
  },
  [RULE_KEYS.NO_EXISTING_CREDIT_CARD]: (s) => {
    const hasCC = s.account_types.includes('CREDIT_CARD')
    return { passed: !hasCC, actual_value: hasCC }
  },
  [RULE_KEYS.NO_EXISTING_HELOC]: (s) => {
    const hasHELOC = s.account_types.includes('HELOC')
    return { passed: !hasHELOC, actual_value: hasHELOC }
  },
  [RULE_KEYS.NO_EXISTING_OVERDRAFT]: (s) => {
    const hasOD = s.account_types.includes('OVERDRAFT')
    return { passed: !hasOD, actual_value: hasOD }
  },
  [RULE_KEYS.MIN_TENURE_MONTHS_3]: (s) => ({
    passed: s.tenure_months >= 3,
    actual_value: s.tenure_months,
  }),
  [RULE_KEYS.MIN_TENURE_MONTHS_6]: (s) => ({
    passed: s.tenure_months >= 6,
    actual_value: s.tenure_months,
  }),
  // Ordinal balance band comparisons
  [RULE_KEYS.MIN_BALANCE_BAND_1K_5K]: (s) => ({
    passed: isAtLeastBand(s.total_balance_band, '1K_5K'),
    actual_value: s.total_balance_band,
  }),
  [RULE_KEYS.MIN_BALANCE_BAND_5K_25K]: (s) => ({
    passed: isAtLeastBand(s.total_balance_band, '5K_25K'),
    actual_value: s.total_balance_band,
  }),
  [RULE_KEYS.MIN_BALANCE_BAND_25K_100K]: (s) => ({
    passed: isAtLeastBand(s.total_balance_band, '25K_100K'),
    actual_value: s.total_balance_band,
  }),
  [RULE_KEYS.NO_OVERDRAFT_LAST_90D]: (s) => {
    const hasOverdraft = s.transaction_pattern_flags.includes('OVERDRAFT_LAST_90D')
    return { passed: !hasOverdraft, actual_value: hasOverdraft }
  },
  // Ordinal income band comparisons
  [RULE_KEYS.MIN_INCOME_BAND_MIDDLE]: (s) => ({
    passed: isAtLeastIncome(s.household_income_band, 'MIDDLE'),
    actual_value: s.household_income_band,
  }),
  [RULE_KEYS.MIN_INCOME_BAND_UPPER_MIDDLE]: (s) => ({
    passed: isAtLeastIncome(s.household_income_band, 'UPPER_MIDDLE'),
    actual_value: s.household_income_band,
  }),
  [RULE_KEYS.HAS_EXTERNAL_ACCOUNT]: (s) => ({
    passed: s.external_account_types.length > 0,
    actual_value: s.external_account_types.length,
  }),
  [RULE_KEYS.HAS_EXISTING_CHECKING]: (s) => ({
    passed: s.account_types.includes('CHECKING'),
    actual_value: s.account_types.includes('CHECKING'),
  }),
}

// Main eligibility evaluation function — pure, no side effects
export function evaluateEligibility(
  signals: CustomerSignals,
  products: Product[]
): EligibilityResult {
  const audit: AuditRecord[] = []
  const eligible: Product[] = []

  for (const product of products) {
    let allPassed = true

    for (const rule of product.eligibility_rules) {
      const predicate = PREDICATE_MAP[rule.rule_key]
      if (!predicate) {
        throw new UnknownRuleKeyError(rule.rule_key)
      }

      const result = predicate(signals)
      audit.push({
        product_id: product.id,
        rule_key: rule.rule_key,
        description: rule.description,
        passed: result.passed,
        actual_value: result.actual_value,
      })

      if (!result.passed) {
        allPassed = false
      }
    }

    if (allPassed) {
      eligible.push(product)
    }
  }

  return { eligible, audit }
}

// Exported for testing only — validates contract coverage
export const _PREDICATE_MAP_KEYS = Object.keys(PREDICATE_MAP)
