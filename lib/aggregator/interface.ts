import type { BalanceBand } from '@/lib/db/types'

export interface ExternalAccount {
  institution_name: string
  account_type: string
  masked_number: string       // last 4 digits
  approx_balance_band: BalanceBand
  last_synced_at: string      // ISO 8601
}

export interface AggregatorProvider {
  getAccounts(customerId: string): Promise<ExternalAccount[]>
}
