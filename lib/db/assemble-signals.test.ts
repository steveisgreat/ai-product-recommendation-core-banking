import { describe, it, expect, afterAll } from 'vitest'
import { assembleCustomerSignals } from './assemble-signals'
import { sql } from './index'

// Known seeded customer IDs
const JAMES_ID = '20000000-0000-0000-0000-000000000002'
const DEREK_ID = '20000000-0000-0000-0000-000000000004'
const NON_EXISTENT_ID = '99999999-9999-9999-9999-999999999999'

afterAll(async () => {
  await sql.end()
})

describe('assembleCustomerSignals', () => {
  it('returns all required CustomerSignals fields for James Okafor', async () => {
    const signals = await assembleCustomerSignals(JAMES_ID)

    // Has all required fields
    expect(signals).toHaveProperty('account_count')
    expect(signals).toHaveProperty('account_types')
    expect(signals).toHaveProperty('total_balance_band')
    expect(signals).toHaveProperty('avg_monthly_inflow_band')
    expect(signals).toHaveProperty('transaction_pattern_flags')
    expect(signals).toHaveProperty('tenure_months')
    expect(signals).toHaveProperty('household_income_band')
    expect(signals).toHaveProperty('external_account_types')
    expect(signals).toHaveProperty('existing_product_ids')
  })

  it('does NOT include protected-class or PII fields', async () => {
    const signals = await assembleCustomerSignals(JAMES_ID)
    const keys = Object.keys(signals)

    const forbiddenKeys = [
      'full_name',
      'name',
      'dob',
      'date_of_birth',
      'age',
      'race',
      'gender',
      'sex',
      'religion',
      'national_origin',
      'marital_status',
    ]

    for (const forbidden of forbiddenKeys) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('returns correct data for James Okafor (1 checking account, MIDDLE income)', async () => {
    const signals = await assembleCustomerSignals(JAMES_ID)

    expect(signals.account_count).toBe(1)
    expect(signals.account_types).toContain('CHECKING')
    expect(signals.household_income_band).toBe('MIDDLE')
    expect(signals.existing_product_ids).toHaveLength(1)
    // James opened his account ~14 months ago — allow ±1 month tolerance
    expect(signals.tenure_months).toBeGreaterThanOrEqual(13)
    expect(signals.tenure_months).toBeLessThanOrEqual(15)
  })

  it('detects OVERDRAFT_LAST_90D for Derek Williams', async () => {
    const signals = await assembleCustomerSignals(DEREK_ID)

    expect(signals.transaction_pattern_flags).toContain('OVERDRAFT_LAST_90D')
  })

  it('throws an error for a non-existent customer ID', async () => {
    await expect(assembleCustomerSignals(NON_EXISTENT_ID)).rejects.toThrow(
      /Customer not found/
    )
  })
})
