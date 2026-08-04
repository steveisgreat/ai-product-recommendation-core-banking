import type { AggregatorProvider, ExternalAccount } from './interface'

// Fixed customer UUIDs from seed data
const CUSTOMER_MARIA_ID  = '20000000-0000-0000-0000-000000000001'
const CUSTOMER_JAMES_ID  = '20000000-0000-0000-0000-000000000002'
const CUSTOMER_PRIYA_ID  = '20000000-0000-0000-0000-000000000003'
const CUSTOMER_DEREK_ID  = '20000000-0000-0000-0000-000000000004'
const CUSTOMER_CHEN_ID   = '20000000-0000-0000-0000-000000000005'

const FIXTURE_DATA: Record<string, ExternalAccount[]> = {
  [CUSTOMER_MARIA_ID]: [],  // No external accounts
  [CUSTOMER_JAMES_ID]: [
    {
      institution_name: 'Chase',
      account_type: 'CHECKING',
      masked_number: '4521',
      approx_balance_band: '5K_25K',
      last_synced_at: new Date().toISOString(),
    },
  ],
  [CUSTOMER_PRIYA_ID]: [
    {
      institution_name: 'Ally',
      account_type: 'SAVINGS',
      masked_number: '8834',
      approx_balance_band: '25K_100K',
      last_synced_at: new Date().toISOString(),
    },
    {
      institution_name: 'Bank of America',
      account_type: 'CHECKING',
      masked_number: '2291',
      approx_balance_band: '5K_25K',
      last_synced_at: new Date().toISOString(),
    },
  ],
  [CUSTOMER_DEREK_ID]: [
    {
      institution_name: 'Fidelity',
      account_type: 'INVESTMENT',
      masked_number: '7743',
      approx_balance_band: 'OVER_100K',
      last_synced_at: new Date().toISOString(),
    },
  ],
  [CUSTOMER_CHEN_ID]: [
    {
      institution_name: 'Wells Fargo',
      account_type: 'CHECKING',
      masked_number: '6677',
      approx_balance_band: '25K_100K',
      last_synced_at: new Date().toISOString(),
    },
    {
      institution_name: 'Marcus',
      account_type: 'SAVINGS',
      masked_number: '3312',
      approx_balance_band: '25K_100K',
      last_synced_at: new Date().toISOString(),
    },
    {
      institution_name: 'Schwab',
      account_type: 'BROKERAGE',
      masked_number: '9901',
      approx_balance_band: 'OVER_100K',
      last_synced_at: new Date().toISOString(),
    },
  ],
}

export class MockAggregatorProvider implements AggregatorProvider {
  async getAccounts(customerId: string): Promise<ExternalAccount[]> {
    // Return fixture data for known customers, empty array for unknown
    return FIXTURE_DATA[customerId] ?? []
  }
}
