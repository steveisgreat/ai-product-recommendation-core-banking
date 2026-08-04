/**
 * lib/origination-service.ts
 *
 * Atomic account creation + ledger entry service.
 * Re-validates eligibility server-side, checks for duplicates,
 * and wraps all writes in a single Postgres transaction.
 */
import { sql } from '@/lib/db/index'
import { assembleCustomerSignals } from '@/lib/db/assemble-signals'
import { evaluateEligibility } from '@/lib/eligibility-engine'
import { getProductsWithRates } from '@/lib/products-with-rates'
import type { Account } from '@/lib/db/types'

// Custom error
export class OriginationError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'OriginationError'
    this.code = code
  }
}

// Result type
export type OriginationResult =
  | { success: true; account: Account }
  | { success: false; duplicate: true; existingAccount: Account }
  | { success: false; notEligible: true }

// Generate a random 10-digit account number
function generateAccountNumber(): string {
  return String(Math.floor(1_000_000_000 + Math.random() * 9_000_000_000))
}

export async function originateAccount(params: {
  customerId: string
  productId: string
  recommendationId: string
  depositAmount: number
}): Promise<OriginationResult> {
  const { customerId, productId, recommendationId, depositAmount } = params

  // Step 1: Fetch product and validate depositAmount
  const products = await sql`SELECT * FROM products WHERE id = ${productId}`
  if (products.length === 0) {
    throw new OriginationError(`Product not found: ${productId}`, 'PRODUCT_NOT_FOUND')
  }
  const product = products[0]

  if (product.requires_deposit && depositAmount <= 0) {
    throw new OriginationError(
      `Product "${product.name}" requires a positive deposit amount`,
      'DEPOSIT_REQUIRED'
    )
  }
  if (!product.requires_deposit && depositAmount !== 0) {
    throw new OriginationError(
      `Product "${product.name}" does not accept a deposit (must be 0)`,
      'DEPOSIT_NOT_ALLOWED'
    )
  }

  // Step 2: Re-assemble signals and re-run eligibility check
  const signals = await assembleCustomerSignals(customerId)
  const allProducts = await getProductsWithRates()
  const { eligible } = evaluateEligibility(signals, allProducts)

  const isEligible = eligible.some(p => p.id === productId)
  if (!isEligible) {
    return { success: false, notEligible: true }
  }

  // Step 3: Check for existing ACTIVE account (duplicate guard)
  const existingAccounts = await sql`
    SELECT * FROM accounts
    WHERE customer_id = ${customerId} AND product_id = ${productId} AND status = 'ACTIVE'
  `
  if (existingAccounts.length > 0) {
    const existing = existingAccounts[0]
    return {
      success: false,
      duplicate: true,
      existingAccount: {
        id: existing.id,
        customer_id: existing.customer_id,
        product_id: existing.product_id,
        account_type: existing.account_type,
        balance: Number(existing.balance),
        opened_at: new Date(existing.opened_at),
        status: existing.status,
        account_number: existing.account_number,
      },
    }
  }

  // Step 4: Generate unique account number (retry up to 3x)
  let accountNumber: string = ''
  let attempts = 0
  const MAX_ATTEMPTS = 3

  while (attempts < MAX_ATTEMPTS) {
    accountNumber = generateAccountNumber()
    const collision = await sql`
      SELECT 1 FROM accounts WHERE account_number = ${accountNumber}
    `
    if (collision.length === 0) break
    attempts++
    if (attempts >= MAX_ATTEMPTS) {
      throw new OriginationError(
        'Failed to generate unique account number after 3 attempts',
        'ACCOUNT_NUMBER_EXHAUSTED'
      )
    }
  }

  // Step 5: Atomic transaction — account + ledger entry + recommendation update
  let newAccount: Account | null = null

  await sql.begin(async (tx) => {
    const now = new Date()

    // INSERT account
    const accountRows = await tx`
      INSERT INTO accounts (customer_id, product_id, account_type, balance, opened_at, status, account_number)
      VALUES (${customerId}, ${productId}, ${product.account_type}, ${depositAmount}, ${now}, 'ACTIVE', ${accountNumber})
      RETURNING *
    `
    const acct = accountRows[0]

    // INSERT opening ledger entry
    await tx`
      INSERT INTO transactions (account_id, amount, type, description, posted_at)
      VALUES (${acct.id}, ${depositAmount}, 'ACCOUNT_OPEN', 'Account opened', ${now})
    `

    // UPDATE recommendation status
    await tx`
      UPDATE recommendations
      SET status = 'ORIGINATED', originated_account_id = ${acct.id}
      WHERE id = ${recommendationId}
    `

    newAccount = {
      id: acct.id,
      customer_id: acct.customer_id,
      product_id: acct.product_id,
      account_type: acct.account_type,
      balance: Number(acct.balance),
      opened_at: new Date(acct.opened_at),
      status: acct.status,
      account_number: acct.account_number,
    }
  })

  // Step 6: Return success
  return { success: true, account: newAccount! }
}
