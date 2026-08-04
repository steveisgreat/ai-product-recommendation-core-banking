// lib/eligibility-rules.ts
// Single source of truth for eligibility rule_key strings.
// Both seed data and the eligibility engine predicate map must import from here.
export const RULE_KEYS = {
  // Product-holding exclusions
  NO_EXISTING_CHECKING:     'no_existing_checking',
  NO_EXISTING_SAVINGS:      'no_existing_savings',
  NO_EXISTING_CD:           'no_existing_cd',
  NO_EXISTING_MMA:          'no_existing_mma',
  NO_EXISTING_CREDIT_CARD:  'no_existing_credit_card',
  NO_EXISTING_HELOC:        'no_existing_heloc',
  NO_EXISTING_OVERDRAFT:    'no_existing_overdraft',
  // Tenure requirements
  MIN_TENURE_MONTHS_3:      'min_tenure_months_3',
  MIN_TENURE_MONTHS_6:      'min_tenure_months_6',
  // Balance band minimums
  MIN_BALANCE_BAND_1K_5K:   'min_balance_band_1k_5k',
  MIN_BALANCE_BAND_5K_25K:  'min_balance_band_5k_25k',
  MIN_BALANCE_BAND_25K_100K:'min_balance_band_25k_100k',
  // Transaction pattern flags
  NO_OVERDRAFT_LAST_90D:    'no_overdraft_last_90d',
  // Income band minimums
  MIN_INCOME_BAND_MIDDLE:       'min_income_band_middle',
  MIN_INCOME_BAND_UPPER_MIDDLE: 'min_income_band_upper_middle',
  // External account signals
  HAS_EXTERNAL_ACCOUNT:     'has_external_account',
  // Existing product requirements
  HAS_EXISTING_CHECKING:    'has_existing_checking',
} as const

export type RuleKey = typeof RULE_KEYS[keyof typeof RULE_KEYS]
