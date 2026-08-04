import { sql } from './index'
import type { CustomerSignals, BalanceBand } from './types'

function toBalanceBand(amount: number): BalanceBand {
  if (amount < 1000) return 'UNDER_1K'
  if (amount < 5000) return '1K_5K'
  if (amount < 25000) return '5K_25K'
  if (amount < 100000) return '25K_100K'
  return 'OVER_100K'
}

function monthsDiff(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
}

export async function assembleCustomerSignals(customerId: string): Promise<CustomerSignals> {
  // Verify customer exists and get income band
  const customers = await sql`
    SELECT household_income_band FROM customers WHERE id = ${customerId}
  `
  if (customers.length === 0) {
    throw new Error(`Customer not found: ${customerId}`)
  }
  const householdIncomeBand = customers[0].household_income_band

  // Get accounts
  const accounts = await sql`
    SELECT id, product_id, account_type, balance, opened_at
    FROM accounts
    WHERE customer_id = ${customerId} AND status = 'ACTIVE'
  `

  const accountCount = accounts.length
  const accountTypes = [...new Set(accounts.map((a) => a.account_type))]
  const existingProductIds = accounts.map((a) => a.product_id)

  // Total balance band
  const totalBalance = accounts.reduce((sum, a) => sum + Number(a.balance), 0)
  const totalBalanceBand = toBalanceBand(totalBalance)

  // Tenure months — difference from earliest opened_at to now
  let tenureMonths = 0
  if (accounts.length > 0) {
    let earliest = new Date(accounts[0].opened_at)
    for (const a of accounts) {
      const openedAt = new Date(a.opened_at)
      if (openedAt < earliest) {
        earliest = openedAt
      }
    }
    tenureMonths = monthsDiff(earliest, new Date())
  }

  // Get all account IDs for transaction queries
  const accountIds = accounts.map((a) => a.id)

  // Average monthly inflow (credits from last 3 months)
  let avgMonthlyInflowBand: BalanceBand = 'UNDER_1K'
  if (accountIds.length > 0) {
    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

    const creditResult = await sql`
      SELECT COALESCE(SUM(amount), 0) as total_credits
      FROM transactions
      WHERE account_id = ANY(${accountIds})
        AND type = 'CREDIT'
        AND posted_at >= ${threeMonthsAgo}
    `
    const totalCredits = Number(creditResult[0].total_credits)
    avgMonthlyInflowBand = toBalanceBand(totalCredits / 3)
  }

  // Transaction pattern flags
  const transactionPatternFlags: string[] = []
  if (accountIds.length > 0) {
    // Check for recurring direct deposit
    const directDepositResult = await sql`
      SELECT COUNT(*) as cnt
      FROM transactions
      WHERE account_id = ANY(${accountIds})
        AND type = 'CREDIT'
        AND (description ILIKE '%Direct Deposit%' OR description ILIKE '%Salary%')
    `
    if (Number(directDepositResult[0].cnt) > 0) {
      transactionPatternFlags.push('RECURRING_DIRECT_DEPOSIT')
    }

    // Check for overdraft in last 90 days
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const overdraftResult = await sql`
      SELECT COUNT(*) as cnt
      FROM transactions
      WHERE account_id = ANY(${accountIds})
        AND type = 'DEBIT'
        AND description ILIKE '%OVERDRAFT%'
        AND posted_at >= ${ninetyDaysAgo}
    `
    if (Number(overdraftResult[0].cnt) > 0) {
      transactionPatternFlags.push('OVERDRAFT_LAST_90D')
    }
  }

  // External account types
  const externalAccounts = await sql`
    SELECT DISTINCT account_type FROM external_accounts WHERE customer_id = ${customerId}
  `
  const externalAccountTypes = externalAccounts.map((e) => e.account_type)

  return {
    account_count: accountCount,
    account_types: accountTypes,
    total_balance_band: totalBalanceBand,
    avg_monthly_inflow_band: avgMonthlyInflowBand,
    transaction_pattern_flags: transactionPatternFlags,
    tenure_months: tenureMonths,
    household_income_band: householdIncomeBand,
    external_account_types: externalAccountTypes,
    existing_product_ids: existingProductIds,
  }
}
