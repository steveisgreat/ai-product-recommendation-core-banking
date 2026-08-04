import { describe, it, expect } from 'vitest'
import { MockAggregatorProvider } from './mock-provider'
import { getProvider } from './index'
import type { ExternalAccount } from './interface'

const JAMES_ID = '20000000-0000-0000-0000-000000000002'
const PRIYA_ID = '20000000-0000-0000-0000-000000000003'
const DEREK_ID = '20000000-0000-0000-0000-000000000004'
const CHEN_ID  = '20000000-0000-0000-0000-000000000005'
const UNKNOWN_ID = '99999999-9999-9999-9999-999999999999'

describe('MockAggregatorProvider', () => {
  const provider = new MockAggregatorProvider()

  it('returns fixture data for James (1 checking at Chase)', async () => {
    const accounts = await provider.getAccounts(JAMES_ID)
    expect(accounts).toHaveLength(1)
    expect(accounts[0].institution_name).toBe('Chase')
    expect(accounts[0].account_type).toBe('CHECKING')
    expect(accounts[0].masked_number).toBe('4521')
    expect(accounts[0].approx_balance_band).toBe('5K_25K')
  })

  it('returns fixture data for Priya (2 accounts)', async () => {
    const accounts = await provider.getAccounts(PRIYA_ID)
    expect(accounts).toHaveLength(2)
    expect(accounts.map(a => a.institution_name)).toContain('Ally')
    expect(accounts.map(a => a.institution_name)).toContain('Bank of America')
  })

  it('returns fixture data for Chen (3 accounts)', async () => {
    const accounts = await provider.getAccounts(CHEN_ID)
    expect(accounts).toHaveLength(3)
    expect(accounts.map(a => a.institution_name).sort()).toEqual(['Marcus', 'Schwab', 'Wells Fargo'])
  })

  it('returns empty array for unknown customer ID (no error)', async () => {
    const accounts = await provider.getAccounts(UNKNOWN_ID)
    expect(accounts).toEqual([])
  })

  it('returns empty array for Maria (no external accounts)', async () => {
    const accounts = await provider.getAccounts('20000000-0000-0000-0000-000000000001')
    expect(accounts).toEqual([])
  })

  it('returns fixture data for Derek (1 investment at Fidelity)', async () => {
    const accounts = await provider.getAccounts(DEREK_ID)
    expect(accounts).toHaveLength(1)
    expect(accounts[0].institution_name).toBe('Fidelity')
    expect(accounts[0].account_type).toBe('INVESTMENT')
    expect(accounts[0].masked_number).toBe('7743')
    expect(accounts[0].approx_balance_band).toBe('OVER_100K')
  })

  it('response shape matches ExternalAccount interface', async () => {
    const accounts = await provider.getAccounts(JAMES_ID)
    const account: ExternalAccount = accounts[0]
    expect(account).toHaveProperty('institution_name')
    expect(account).toHaveProperty('account_type')
    expect(account).toHaveProperty('masked_number')
    expect(account).toHaveProperty('approx_balance_band')
    expect(account).toHaveProperty('last_synced_at')
    // Verify last_synced_at is a valid ISO date string
    expect(new Date(account.last_synced_at).toISOString()).toBe(account.last_synced_at)
  })
})

describe('getProvider', () => {
  it('returns MockAggregatorProvider when AGGREGATOR_PROVIDER is "mock"', () => {
    process.env.AGGREGATOR_PROVIDER = 'mock'
    const provider = getProvider()
    expect(provider).toBeInstanceOf(MockAggregatorProvider)
  })

  it('returns MockAggregatorProvider when AGGREGATOR_PROVIDER is not set', () => {
    delete process.env.AGGREGATOR_PROVIDER
    const provider = getProvider()
    expect(provider).toBeInstanceOf(MockAggregatorProvider)
  })

  it('returns MockAggregatorProvider with warning for unknown provider value', () => {
    process.env.AGGREGATOR_PROVIDER = 'unknown_provider'
    const provider = getProvider()
    expect(provider).toBeInstanceOf(MockAggregatorProvider)
  })
})
