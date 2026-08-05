/**
 * tests/e2e/happy-path.test.ts
 *
 * End-to-end smoke test covering the full happy path:
 * customers → aggregator → recommendations → dismiss → originate → history → audit → duplicate
 *
 * Runs against the real Neon DB with seeded data.
 * Calls service functions directly (same as API routes) to avoid needing a running server.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { sql } from '@/lib/db/index'
import { assembleCustomerSignals } from '@/lib/db/assemble-signals'
import { getProductsWithRates } from '@/lib/products-with-rates'
import { getProvider } from '@/lib/aggregator/index'
import { generateRecommendations } from '@/lib/recommendation-engine'
import { originateAccount } from '@/lib/origination-service'

// James Okafor — has 1 checking account, eligible for multiple products
const CUSTOMER_JAMES_ID = '20000000-0000-0000-0000-000000000002'

// Track created data for cleanup
let testSessionId: string | null = null
const testRecIds: string[] = []
const testAccountIds: string[] = []

afterAll(async () => {
  // Clean up in dependency order
  if (testAccountIds.length > 0) {
    await sql`UPDATE recommendations SET originated_account_id = NULL WHERE originated_account_id = ANY(${testAccountIds})`
    await sql`DELETE FROM transactions WHERE account_id = ANY(${testAccountIds})`
    await sql`DELETE FROM accounts WHERE id = ANY(${testAccountIds})`
  }
  if (testRecIds.length > 0) {
    await sql`DELETE FROM recommendations WHERE id = ANY(${testRecIds})`
  }
  if (testSessionId) {
    await sql`DELETE FROM eligibility_audit WHERE session_id = ${testSessionId}`
  }
  await sql.end()
})

describe('E2E Happy Path', () => {
  it('1. GET /api/customers — returns at least 1 customer', async () => {
    const rows = await sql`SELECT id, full_name FROM customers`
    expect(rows.length).toBeGreaterThanOrEqual(1)
  })

  it('2. GET /api/customers/[id] — returns customer with accounts', async () => {
    const customers = await sql`SELECT * FROM customers WHERE id = ${CUSTOMER_JAMES_ID}`
    expect(customers).toHaveLength(1)
    expect(customers[0].full_name).toBe('James Okafor')

    const accounts = await sql`SELECT * FROM accounts WHERE customer_id = ${CUSTOMER_JAMES_ID}`
    expect(accounts.length).toBeGreaterThanOrEqual(1)
  })

  it('3. GET /api/mock-aggregator/[customerId] — returns external accounts', async () => {
    const provider = getProvider()
    const accounts = await provider.getAccounts(CUSTOMER_JAMES_ID)
    // James has 1 external checking at Chase
    expect(accounts).toHaveLength(1)
    expect(accounts[0].institution_name).toBe('Chase')
  })

  it('4. POST /api/recommendations — generates 1-3 recommendations with sessionId', async () => {
    const result = await generateRecommendations(CUSTOMER_JAMES_ID)

    expect(result.eligible).toBe(true)
    if (result.eligible) {
      expect(result.sessionId).toBeDefined()
      expect(result.recommendations.length).toBeGreaterThanOrEqual(1)
      expect(result.recommendations.length).toBeLessThanOrEqual(3)
      expect(result.sessionComplianceNote).toBeDefined()
      expect(result.sessionComplianceNote.length).toBeGreaterThan(0)

      testSessionId = result.sessionId
      testRecIds.push(...result.recommendations.map(r => r.id))

      // Each recommendation has required fields
      for (const rec of result.recommendations) {
        expect(rec.id).toBeDefined()
        expect(rec.product_id).toBeDefined()
        expect(rec.rank).toBeGreaterThanOrEqual(1)
        expect(rec.rank).toBeLessThanOrEqual(3)
        expect(rec.rationale.length).toBeGreaterThan(0)
      }
    }
  }, 30_000) // 30s timeout for Claude API call

  it('5. PATCH dismiss — dismisses a recommendation with 90-day cooldown', async () => {
    // Dismiss the last recommendation — replicate the actual route handler logic
    // (fetch row, check status is PENDING, then update) rather than a blind UPDATE
    const recToDismiss = testRecIds[testRecIds.length - 1]
    expect(recToDismiss).toBeDefined()

    // Step 1: Fetch the row (same as route handler does)
    const rows = await sql`SELECT * FROM recommendations WHERE id = ${recToDismiss}`
    expect(rows).toHaveLength(1)

    // Step 2: Verify status is PENDING (the 409 guard the route enforces)
    expect(rows[0].status).toBe('PENDING')

    // Step 3: Perform the update (same as route handler)
    const updated = await sql`
      UPDATE recommendations
      SET status = 'DISMISSED', dismissed_until = now() + interval '90 days'
      WHERE id = ${recToDismiss} AND status = 'PENDING'
      RETURNING *
    `
    expect(updated).toHaveLength(1)
    expect(updated[0].status).toBe('DISMISSED')
    expect(updated[0].dismissed_until).not.toBeNull()

    // Step 4: Verify re-dismissing the same row fails (simulates 409 — already dismissed)
    const reDismiss = await sql`
      UPDATE recommendations
      SET status = 'DISMISSED', dismissed_until = now() + interval '90 days'
      WHERE id = ${recToDismiss} AND status = 'PENDING'
      RETURNING *
    `
    // Should return 0 rows since status is no longer PENDING
    expect(reDismiss).toHaveLength(0)
  })

  it('6. POST /api/originate — originates an account with valid deposit', async () => {
    const recToOriginate = testRecIds[0]
    expect(recToOriginate).toBeDefined()

    // Get the product_id for this recommendation
    const recRows = await sql`SELECT product_id FROM recommendations WHERE id = ${recToOriginate}`
    const productId = recRows[0].product_id

    // Get product details to determine deposit amount
    const products = await getProductsWithRates()
    const product = products.find(p => p.id === productId)
    expect(product).toBeDefined()

    const depositAmount = product!.requires_deposit ? 500 : 0

    const result = await originateAccount({
      customerId: CUSTOMER_JAMES_ID,
      productId,
      recommendationId: recToOriginate,
      depositAmount,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.account.customer_id).toBe(CUSTOMER_JAMES_ID)
      expect(result.account.product_id).toBe(productId)
      expect(result.account.account_number).toMatch(/^\d{10}$/)
      expect(result.account.status).toBe('ACTIVE')
      expect(result.account.balance).toBe(depositAmount)
      testAccountIds.push(result.account.id)
    }
  }, 30_000)

  it('7. GET /api/recommendations/[customerId] — shows ORIGINATED status', async () => {
    const rows = await sql`
      SELECT * FROM recommendations
      WHERE id = ${testRecIds[0]}
    `
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('ORIGINATED')
    expect(rows[0].originated_account_id).not.toBeNull()
  })

  it('8. GET /api/eligibility-audit/[sessionId] — returns audit records', async () => {
    expect(testSessionId).not.toBeNull()

    const rows = await sql`
      SELECT * FROM eligibility_audit WHERE session_id = ${testSessionId}
    `
    expect(rows.length).toBeGreaterThanOrEqual(1)

    // Each audit record has required fields
    for (const row of rows) {
      expect(row.product_id).toBeDefined()
      expect(row.overall_eligible).toBeDefined()
      expect(row.rules_evaluated).toBeDefined()
    }
  })

  it('9. Repeat originate for same product — returns notEligible or duplicate', async () => {
    const recRows = await sql`SELECT product_id FROM recommendations WHERE id = ${testRecIds[0]}`
    const productId = recRows[0].product_id

    const products = await getProductsWithRates()
    const product = products.find(p => p.id === productId)
    const depositAmount = product!.requires_deposit ? 500 : 0

    // Create a fresh recommendation row for the retry
    const newRecRows = await sql`
      INSERT INTO recommendations (session_id, customer_id, product_id, rank, rationale, compliance_note, status)
      VALUES (gen_random_uuid(), ${CUSTOMER_JAMES_ID}, ${productId}, 1, 'Retry test', 'Test', 'PENDING')
      RETURNING id
    `
    testRecIds.push(newRecRows[0].id)

    const result = await originateAccount({
      customerId: CUSTOMER_JAMES_ID,
      productId,
      recommendationId: newRecRows[0].id,
      depositAmount,
    })

    // Should be either duplicate (if product has no "no_existing" rule blocking it)
    // or notEligible (if the eligibility re-check catches the existing account)
    expect(result.success).toBe(false)
    if (!result.success) {
      const isDuplicate = 'duplicate' in result && result.duplicate === true
      const isNotEligible = 'notEligible' in result && result.notEligible === true
      expect(isDuplicate || isNotEligible).toBe(true)
    }
  }, 30_000)
})
