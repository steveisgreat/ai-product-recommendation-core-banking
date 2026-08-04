// Shared enums
export type BalanceBand = 'UNDER_1K' | '1K_5K' | '5K_25K' | '25K_100K' | 'OVER_100K'
export type IncomeBand = 'LOW' | 'LOWER_MIDDLE' | 'MIDDLE' | 'UPPER_MIDDLE' | 'HIGH'
export type AccountStatus = 'ACTIVE' | 'CLOSED'
export type RecommendationStatus = 'PENDING' | 'ORIGINATED' | 'DISMISSED'
export type TransactionType = 'DEBIT' | 'CREDIT' | 'ACCOUNT_OPEN'

// DB entity types
export interface Customer {
  id: string
  full_name: string
  household_size: number
  household_income_band: IncomeBand
  created_at: Date
}

export interface Product {
  id: string
  name: string
  account_type: string
  requires_deposit: boolean
  rate: number | null
  eligibility_rules: EligibilityRule[]
  description: string
}

export interface EligibilityRule {
  rule_key: string
  description: string
}

export interface Account {
  id: string
  customer_id: string
  product_id: string
  account_type: string
  balance: number
  opened_at: Date
  status: AccountStatus
  account_number: string
}

export interface Transaction {
  id: string
  account_id: string
  amount: number
  type: TransactionType
  description: string
  posted_at: Date
}

export interface ExternalAccount {
  id: string
  customer_id: string
  institution_name: string
  account_type: string
  masked_number: string
  approx_balance_band: BalanceBand
  last_synced_at: Date
}

export interface Recommendation {
  id: string
  session_id: string
  customer_id: string
  product_id: string
  rank: number
  rationale: string
  compliance_note: string
  status: RecommendationStatus
  originated_account_id: string | null
  dismissed_until: Date | null
  created_at: Date
}

export interface EligibilityAudit {
  id: string
  session_id: string
  customer_id: string
  product_id: string
  rules_evaluated: AuditRuleResult[]
  overall_eligible: boolean
  evaluated_at: Date
}

export interface AuditRuleResult {
  rule_key: string
  description: string
  passed: boolean
  actual_value: string | number | boolean
}

// The anonymized signal struct — structurally excludes name, DOB, protected-class fields
// This is the ONLY input to both the eligibility engine and the LLM payload builder
export interface CustomerSignals {
  account_count: number
  account_types: string[]
  total_balance_band: BalanceBand
  avg_monthly_inflow_band: BalanceBand
  transaction_pattern_flags: string[] // e.g. 'RECURRING_DIRECT_DEPOSIT', 'OVERDRAFT_LAST_90D'
  tenure_months: number
  household_income_band: IncomeBand
  external_account_types: string[]
  existing_product_ids: string[]
}
