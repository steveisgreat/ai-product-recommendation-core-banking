/**
 * scripts/seed.ts
 *
 * Seeds the database with products, customers, accounts, transactions,
 * and external accounts for development and testing.
 *
 * Idempotent: deletes existing seed data in dependency order before inserting.
 * Uses fixed deterministic UUIDs so the script is repeatable.
 *
 * Usage:
 *   pnpm seed
 */

import { join } from 'path'
import { config } from 'dotenv'
import postgres from 'postgres'
import { RULE_KEYS } from '../lib/eligibility-rules'

config({ path: join(process.cwd(), '.env.local') })

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error(
    'ERROR: DATABASE_URL environment variable is not set.\n' +
      '       Add it to .env.local or export it before running pnpm seed.'
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Fixed deterministic UUIDs
// ---------------------------------------------------------------------------

// Products
const PRODUCT_CHECKING_ID     = '10000000-0000-0000-0000-000000000001'
const PRODUCT_SAVINGS_ID      = '10000000-0000-0000-0000-000000000002'
const PRODUCT_CD_ID           = '10000000-0000-0000-0000-000000000003'
const PRODUCT_MMA_ID          = '10000000-0000-0000-0000-000000000004'
const PRODUCT_CREDIT_CARD_ID  = '10000000-0000-0000-0000-000000000005'
const PRODUCT_HELOC_ID        = '10000000-0000-0000-0000-000000000006'
const PRODUCT_OVERDRAFT_ID    = '10000000-0000-0000-0000-000000000007'

// Customers
const CUSTOMER_MARIA_ID   = '20000000-0000-0000-0000-000000000001'
const CUSTOMER_JAMES_ID   = '20000000-0000-0000-0000-000000000002'
const CUSTOMER_PRIYA_ID   = '20000000-0000-0000-0000-000000000003'
const CUSTOMER_DEREK_ID   = '20000000-0000-0000-0000-000000000004'
const CUSTOMER_CHEN_ID    = '20000000-0000-0000-0000-000000000005'

// Accounts
const ACCOUNT_MARIA_CHECKING_ID   = '30000000-0000-0000-0000-000000000001'
const ACCOUNT_JAMES_CHECKING_ID   = '30000000-0000-0000-0000-000000000002'
const ACCOUNT_PRIYA_CHECKING_ID   = '30000000-0000-0000-0000-000000000003'
const ACCOUNT_PRIYA_SAVINGS_ID    = '30000000-0000-0000-0000-000000000004'
const ACCOUNT_DEREK_CHECKING_ID   = '30000000-0000-0000-0000-000000000005'
const ACCOUNT_CHEN_CHECKING_ID    = '30000000-0000-0000-0000-000000000006'
const ACCOUNT_CHEN_SAVINGS_ID     = '30000000-0000-0000-0000-000000000007'
const ACCOUNT_CHEN_MMA_ID         = '30000000-0000-0000-0000-000000000008'

// External accounts
const EXT_JAMES_CHASE_ID      = '40000000-0000-0000-0000-000000000001'
const EXT_PRIYA_ALLY_ID       = '40000000-0000-0000-0000-000000000002'
const EXT_PRIYA_BOA_ID        = '40000000-0000-0000-0000-000000000003'
const EXT_CHEN_WELLS_ID       = '40000000-0000-0000-0000-000000000004'
const EXT_CHEN_MARCUS_ID      = '40000000-0000-0000-0000-000000000005'
const EXT_CHEN_SCHWAB_ID      = '40000000-0000-0000-0000-000000000006'

// ---------------------------------------------------------------------------
// Helper: generate a date N months ago from now
// ---------------------------------------------------------------------------
function monthsAgo(n: number): Date {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d
}

// Helper: generate a date between two dates (deterministic based on index/total)
function dateBetween(start: Date, end: Date, index: number, total: number): Date {
  const startMs = start.getTime()
  const endMs = end.getTime()
  const step = (endMs - startMs) / (total + 1)
  return new Date(startMs + step * (index + 1))
}

// Helper: generate a date N days ago
function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

// ---------------------------------------------------------------------------
// Seed data definitions
// ---------------------------------------------------------------------------

const products = [
  {
    id: PRODUCT_CHECKING_ID,
    name: 'Checking Account',
    account_type: 'CHECKING',
    requires_deposit: true,
    rate: '0.0000',
    description: 'Everyday checking account with no monthly fees and nationwide ATM access.',
    eligibility_rules: [
      { rule_key: RULE_KEYS.NO_EXISTING_CHECKING, description: 'Customer must not already have a checking account' },
    ],
  },
  {
    id: PRODUCT_SAVINGS_ID,
    name: 'High-Yield Savings',
    account_type: 'SAVINGS',
    requires_deposit: true,
    rate: '5.2500',
    description: 'High-yield savings account with competitive APY and no minimum balance after opening.',
    eligibility_rules: [
      { rule_key: RULE_KEYS.NO_EXISTING_SAVINGS, description: 'Customer must not already have a savings account' },
      { rule_key: RULE_KEYS.MIN_BALANCE_BAND_1K_5K, description: 'Customer total balance must be in the $1K-$5K band or higher' },
    ],
  },
  {
    id: PRODUCT_CD_ID,
    name: 'Certificate of Deposit 12mo',
    account_type: 'CD',
    requires_deposit: true,
    rate: '6.2500',
    description: '12-month certificate of deposit with guaranteed fixed rate and FDIC insurance.',
    eligibility_rules: [
      { rule_key: RULE_KEYS.NO_EXISTING_CD, description: 'Customer must not already have a CD' },
      { rule_key: RULE_KEYS.MIN_BALANCE_BAND_5K_25K, description: 'Customer total balance must be in the $5K-$25K band or higher' },
    ],
  },
  {
    id: PRODUCT_MMA_ID,
    name: 'Money Market Account',
    account_type: 'MONEY_MARKET',
    requires_deposit: true,
    rate: '5.5000',
    description: 'Money market account combining high yields with check-writing flexibility.',
    eligibility_rules: [
      { rule_key: RULE_KEYS.NO_EXISTING_MMA, description: 'Customer must not already have a money market account' },
      { rule_key: RULE_KEYS.MIN_BALANCE_BAND_25K_100K, description: 'Customer total balance must be in the $25K-$100K band or higher' },
    ],
  },
  {
    id: PRODUCT_CREDIT_CARD_ID,
    name: 'Credit Card',
    account_type: 'CREDIT_CARD',
    requires_deposit: false,
    rate: '21.9900',
    description: 'Rewards credit card with cashback on everyday purchases and no annual fee.',
    eligibility_rules: [
      { rule_key: RULE_KEYS.NO_EXISTING_CREDIT_CARD, description: 'Customer must not already have a credit card' },
      { rule_key: RULE_KEYS.MIN_TENURE_MONTHS_6, description: 'Customer must have at least 6 months tenure' },
      { rule_key: RULE_KEYS.NO_OVERDRAFT_LAST_90D, description: 'Customer must have no overdraft events in the last 90 days' },
      { rule_key: RULE_KEYS.MIN_INCOME_BAND_MIDDLE, description: 'Customer income band must be MIDDLE or higher' },
    ],
  },
  {
    id: PRODUCT_HELOC_ID,
    name: 'HELOC',
    account_type: 'HELOC',
    requires_deposit: false,
    rate: '9.5000',
    description: 'Home equity line of credit with flexible draw periods and competitive variable rates.',
    eligibility_rules: [
      { rule_key: RULE_KEYS.NO_EXISTING_HELOC, description: 'Customer must not already have a HELOC' },
      { rule_key: RULE_KEYS.MIN_BALANCE_BAND_25K_100K, description: 'Customer total balance must be in the $25K-$100K band or higher' },
      { rule_key: RULE_KEYS.HAS_EXTERNAL_ACCOUNT, description: 'Customer must have at least one linked external account' },
      { rule_key: RULE_KEYS.MIN_INCOME_BAND_UPPER_MIDDLE, description: 'Customer income band must be UPPER_MIDDLE or higher' },
    ],
  },
  {
    id: PRODUCT_OVERDRAFT_ID,
    name: 'Overdraft Protection',
    account_type: 'OVERDRAFT',
    requires_deposit: false,
    rate: '13.5000',
    description: 'Overdraft protection line that automatically covers checking shortfalls.',
    eligibility_rules: [
      { rule_key: RULE_KEYS.NO_EXISTING_OVERDRAFT, description: 'Customer must not already have overdraft protection' },
      { rule_key: RULE_KEYS.HAS_EXISTING_CHECKING, description: 'Customer must have an existing checking account' },
    ],
  },
]

const customers = [
  {
    id: CUSTOMER_MARIA_ID,
    full_name: 'Maria Santos',
    household_size: 2,
    household_income_band: 'MIDDLE',
  },
  {
    id: CUSTOMER_JAMES_ID,
    full_name: 'James Okafor',
    household_size: 1,
    household_income_band: 'MIDDLE',
  },
  {
    id: CUSTOMER_PRIYA_ID,
    full_name: 'Priya Patel',
    household_size: 4,
    household_income_band: 'UPPER_MIDDLE',
  },
  {
    id: CUSTOMER_DEREK_ID,
    full_name: 'Derek Williams',
    household_size: 3,
    household_income_band: 'LOWER_MIDDLE',
  },
  {
    id: CUSTOMER_CHEN_ID,
    full_name: 'Chen Wei',
    household_size: 2,
    household_income_band: 'HIGH',
  },
]

const accounts = [
  {
    id: ACCOUNT_MARIA_CHECKING_ID,
    customer_id: CUSTOMER_MARIA_ID,
    product_id: PRODUCT_CHECKING_ID,
    account_type: 'CHECKING',
    balance: '500.00',
    opened_at: monthsAgo(2),
    account_number: '1000000001',
  },
  {
    id: ACCOUNT_JAMES_CHECKING_ID,
    customer_id: CUSTOMER_JAMES_ID,
    product_id: PRODUCT_CHECKING_ID,
    account_type: 'CHECKING',
    balance: '8200.00',
    opened_at: monthsAgo(14),
    account_number: '1000000002',
  },
  {
    id: ACCOUNT_PRIYA_CHECKING_ID,
    customer_id: CUSTOMER_PRIYA_ID,
    product_id: PRODUCT_CHECKING_ID,
    account_type: 'CHECKING',
    balance: '12000.00',
    opened_at: monthsAgo(24),
    account_number: '1000000003',
  },
  {
    id: ACCOUNT_PRIYA_SAVINGS_ID,
    customer_id: CUSTOMER_PRIYA_ID,
    product_id: PRODUCT_SAVINGS_ID,
    account_type: 'SAVINGS',
    balance: '33000.00',
    opened_at: monthsAgo(24),
    account_number: '1000000004',
  },
  {
    id: ACCOUNT_DEREK_CHECKING_ID,
    customer_id: CUSTOMER_DEREK_ID,
    product_id: PRODUCT_CHECKING_ID,
    account_type: 'CHECKING',
    balance: '2100.00',
    opened_at: monthsAgo(8),
    account_number: '1000000005',
  },
  {
    id: ACCOUNT_CHEN_CHECKING_ID,
    customer_id: CUSTOMER_CHEN_ID,
    product_id: PRODUCT_CHECKING_ID,
    account_type: 'CHECKING',
    balance: '15000.00',
    opened_at: monthsAgo(36),
    account_number: '1000000006',
  },
  {
    id: ACCOUNT_CHEN_SAVINGS_ID,
    customer_id: CUSTOMER_CHEN_ID,
    product_id: PRODUCT_SAVINGS_ID,
    account_type: 'SAVINGS',
    balance: '45000.00',
    opened_at: monthsAgo(36),
    account_number: '1000000007',
  },
  {
    id: ACCOUNT_CHEN_MMA_ID,
    customer_id: CUSTOMER_CHEN_ID,
    product_id: PRODUCT_MMA_ID,
    account_type: 'MONEY_MARKET',
    balance: '60000.00',
    opened_at: monthsAgo(36),
    account_number: '1000000008',
  },
]

// Generate transaction data for each account
interface Transaction {
  account_id: string
  amount: string
  type: 'CREDIT' | 'DEBIT' | 'ACCOUNT_OPEN'
  description: string
  posted_at: Date
}

function generateTransactions(
  accountId: string,
  openedAt: Date,
  includeOverdraft: boolean
): Transaction[] {
  const now = new Date()
  const txns: Transaction[] = []

  // Account opening transaction
  txns.push({
    account_id: accountId,
    amount: '0.00',
    type: 'ACCOUNT_OPEN',
    description: 'Account opened',
    posted_at: openedAt,
  })

  // Regular salary/deposit credits
  const creditDescriptions = ['Direct Deposit - Salary', 'ACH Transfer In', 'Mobile Deposit', 'Wire Transfer In']
  const creditAmounts = ['2500.00', '1800.00', '3000.00', '1200.00', '2200.00']

  // Regular debits
  const debitDescriptions = ['Grocery Store', 'Electric Bill', 'Internet Service', 'Gas Station', 'Restaurant']
  const debitAmounts = ['125.50', '185.00', '89.99', '52.30', '67.80', '245.00', '150.00']

  // Generate 10 regular transactions spread across the account tenure
  for (let i = 0; i < 10; i++) {
    const txDate = dateBetween(openedAt, now, i, 10)
    if (i % 3 === 0) {
      // Credit transaction
      txns.push({
        account_id: accountId,
        amount: creditAmounts[i % creditAmounts.length],
        type: 'CREDIT',
        description: creditDescriptions[i % creditDescriptions.length],
        posted_at: txDate,
      })
    } else {
      // Debit transaction
      txns.push({
        account_id: accountId,
        amount: debitAmounts[i % debitAmounts.length],
        type: 'DEBIT',
        description: debitDescriptions[i % debitDescriptions.length],
        posted_at: txDate,
      })
    }
  }

  // Add overdraft fees for Derek's account
  if (includeOverdraft) {
    txns.push({
      account_id: accountId,
      amount: '35.00',
      type: 'DEBIT',
      description: 'OVERDRAFT FEE',
      posted_at: daysAgo(45),
    })
    txns.push({
      account_id: accountId,
      amount: '35.00',
      type: 'DEBIT',
      description: 'OVERDRAFT FEE',
      posted_at: daysAgo(30),
    })
  }

  return txns
}

const allTransactions: Transaction[] = [
  ...generateTransactions(ACCOUNT_MARIA_CHECKING_ID, monthsAgo(2), false),
  ...generateTransactions(ACCOUNT_JAMES_CHECKING_ID, monthsAgo(14), false),
  ...generateTransactions(ACCOUNT_PRIYA_CHECKING_ID, monthsAgo(24), false),
  ...generateTransactions(ACCOUNT_PRIYA_SAVINGS_ID, monthsAgo(24), false),
  ...generateTransactions(ACCOUNT_DEREK_CHECKING_ID, monthsAgo(8), true),
  ...generateTransactions(ACCOUNT_CHEN_CHECKING_ID, monthsAgo(36), false),
  ...generateTransactions(ACCOUNT_CHEN_SAVINGS_ID, monthsAgo(36), false),
  ...generateTransactions(ACCOUNT_CHEN_MMA_ID, monthsAgo(36), false),
]

const externalAccounts = [
  {
    id: EXT_JAMES_CHASE_ID,
    customer_id: CUSTOMER_JAMES_ID,
    institution_name: 'Chase',
    account_type: 'CHECKING',
    masked_number: '4521',
    approx_balance_band: '5K_25K',
  },
  {
    id: EXT_PRIYA_ALLY_ID,
    customer_id: CUSTOMER_PRIYA_ID,
    institution_name: 'Ally',
    account_type: 'SAVINGS',
    masked_number: '8834',
    approx_balance_band: '25K_100K',
  },
  {
    id: EXT_PRIYA_BOA_ID,
    customer_id: CUSTOMER_PRIYA_ID,
    institution_name: 'Bank of America',
    account_type: 'CHECKING',
    masked_number: '2291',
    approx_balance_band: '5K_25K',
  },
  {
    id: EXT_CHEN_WELLS_ID,
    customer_id: CUSTOMER_CHEN_ID,
    institution_name: 'Wells Fargo',
    account_type: 'CHECKING',
    masked_number: '6677',
    approx_balance_band: '25K_100K',
  },
  {
    id: EXT_CHEN_MARCUS_ID,
    customer_id: CUSTOMER_CHEN_ID,
    institution_name: 'Marcus',
    account_type: 'SAVINGS',
    masked_number: '3312',
    approx_balance_band: '25K_100K',
  },
  {
    id: EXT_CHEN_SCHWAB_ID,
    customer_id: CUSTOMER_CHEN_ID,
    institution_name: 'Schwab',
    account_type: 'BROKERAGE',
    masked_number: '9901',
    approx_balance_band: 'OVER_100K',
  },
]

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------

async function seed(): Promise<void> {
  const sql = postgres(DATABASE_URL as string, { max: 1, connect_timeout: 10 })

  try {
    console.log('Clearing existing seed data...')

    // Delete in dependency order (child tables first)
    await sql`DELETE FROM eligibility_audit`
    await sql`DELETE FROM transactions`
    await sql`DELETE FROM recommendations`
    await sql`DELETE FROM external_accounts`
    await sql`DELETE FROM accounts`
    await sql`DELETE FROM customers`
    await sql`DELETE FROM products`

    console.log('  ✓ Existing data cleared\n')

    // Insert products
    console.log('Inserting products...')
    for (const p of products) {
      await sql`
        INSERT INTO products (id, name, account_type, requires_deposit, rate, eligibility_rules, description)
        VALUES (${p.id}, ${p.name}, ${p.account_type}, ${p.requires_deposit}, ${p.rate}, ${JSON.stringify(p.eligibility_rules)}, ${p.description})
      `
    }
    console.log(`  ✓ ${products.length} products inserted`)

    // Insert customers
    console.log('Inserting customers...')
    for (const c of customers) {
      await sql`
        INSERT INTO customers (id, full_name, household_size, household_income_band, created_at)
        VALUES (${c.id}, ${c.full_name}, ${c.household_size}, ${c.household_income_band}, now())
      `
    }
    console.log(`  ✓ ${customers.length} customers inserted`)

    // Insert accounts
    console.log('Inserting accounts...')
    for (const a of accounts) {
      await sql`
        INSERT INTO accounts (id, customer_id, product_id, account_type, balance, opened_at, status, account_number)
        VALUES (${a.id}, ${a.customer_id}, ${a.product_id}, ${a.account_type}, ${a.balance}, ${a.opened_at}, 'ACTIVE', ${a.account_number})
      `
    }
    console.log(`  ✓ ${accounts.length} accounts inserted`)

    // Insert transactions
    console.log('Inserting transactions...')
    for (const t of allTransactions) {
      await sql`
        INSERT INTO transactions (account_id, amount, type, description, posted_at)
        VALUES (${t.account_id}, ${t.amount}, ${t.type}, ${t.description}, ${t.posted_at})
      `
    }
    console.log(`  ✓ ${allTransactions.length} transactions inserted`)

    // Insert external accounts
    console.log('Inserting external accounts...')
    for (const e of externalAccounts) {
      await sql`
        INSERT INTO external_accounts (id, customer_id, institution_name, account_type, masked_number, approx_balance_band)
        VALUES (${e.id}, ${e.customer_id}, ${e.institution_name}, ${e.account_type}, ${e.masked_number}, ${e.approx_balance_band})
      `
    }
    console.log(`  ✓ ${externalAccounts.length} external accounts inserted`)

    // Verification: count rows
    console.log('\nVerification:')
    const [prodCount] = await sql`SELECT count(*) as n FROM products`
    const [custCount] = await sql`SELECT count(*) as n FROM customers`
    const [acctCount] = await sql`SELECT count(*) as n FROM accounts`
    const [txnCount] = await sql`SELECT count(*) as n FROM transactions`
    const [extCount] = await sql`SELECT count(*) as n FROM external_accounts`

    console.log(`  Products:          ${prodCount.n}`)
    console.log(`  Customers:         ${custCount.n}`)
    console.log(`  Accounts:          ${acctCount.n}`)
    console.log(`  Transactions:      ${txnCount.n}`)
    console.log(`  External Accounts: ${extCount.n}`)

    console.log('\nSeed completed successfully.')
  } finally {
    await sql.end()
  }
}

seed().catch((err: unknown) => {
  console.error('\nSeed failed:')
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
