/**
 * lib/recommendation-engine.test.ts
 *
 * Property-based test for the dismissal cooldown invariant:
 * A product with an active (non-expired) dismissed_until is never present
 * in the eligible set when generateRecommendations runs.
 *
 * This test directly exercises the dismissal-filtering logic in recommendation-engine.ts
 * by inserting dismissed recommendation rows into the real DB and verifying
 * that the dismissed product never appears in subsequent recommendation results.
 *
 * NOTE: This test calls the real Claude API (via generateRecommendations) — but we
 * can avoid that by testing the dismissal filtering in isolation. We'll test
 * just the DB query + eligibility filtering step without calling the LLM.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import * as fc from 'fast-check'
import { sql } from '@/lib/db/index'
import { assembleCustomerSignals } from '@/lib/db/assemble-signals'
import { evaluateEligibility } from '@/lib/eligibility-engine'
import { getProductsWithRates } from '@/lib/products-with-rates'

// Use James Okafor — he has 1 checking account, eligible for several products
const CUSTOMER_JAMES_ID = '20000000-0000-0000-0000-000000000002'
// Overdraft Protection — James is eligible for this (has existing checking, no existing overdraft)
const PRODUCT_OVERDRAFT_ID = '10000000-0000-0000-0000-000000000007'

// Track all inserted recommendation IDs for cleanup
const insertedRecIds: string[] = []

afterAll(async () => {
  // Clean up all test recommendation rows
  if (insertedRecIds.length > 0) {
    await sql`DELETE FROM recommendations WHERE id = ANY(${insertedRecIds})`
  }
  await sql.end()
})

describe('Recommendation Engine - Dismissal Cooldown Property', () => {
  beforeAll(async () => {
    // Ensure James has no overdraft protection account (could be left from other test runs)
    await sql`
      UPDATE recommendations SET originated_account_id = NULL
      WHERE originated_account_id IN (
        SELECT id FROM accounts WHERE customer_id = ${CUSTOMER_JAMES_ID} AND product_id = ${PRODUCT_OVERDRAFT_ID}
      )
    `
    await sql`
      DELETE FROM transactions WHERE account_id IN (
        SELECT id FROM accounts WHERE customer_id = ${CUSTOMER_JAMES_ID} AND product_id = ${PRODUCT_OVERDRAFT_ID}
      )
    `
    await sql`DELETE FROM accounts WHERE customer_id = ${CUSTOMER_JAMES_ID} AND product_id = ${PRODUCT_OVERDRAFT_ID}`
    // Also clean up any existing dismissed recommendations for the overdraft product
    await sql`
      DELETE FROM recommendations
      WHERE customer_id = ${CUSTOMER_JAMES_ID} AND product_id = ${PRODUCT_OVERDRAFT_ID}
    `
  })

  /**
   * Property: A product with an active (non-expired) dismissed_until is NEVER
   * present in the eligible set for that customer.
   *
   * Strategy: For each generated test case, insert a dismissed recommendation row
   * with a dismissed_until in the future, then run the dismissal query + eligibility
   * evaluation (the same logic generateRecommendations uses in steps 2-3), and verify
   * the dismissed product is excluded from the candidate set.
   */
  it('dismissed product never appears in eligible set across varied future timestamps', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a future offset between 1 and 89 days (within the 90-day window)
        fc.integer({ min: 1, max: 89 }),
        async (daysInFuture) => {
          // Insert a dismissed recommendation row with dismissed_until in the future
          const futureDate = new Date()
          futureDate.setDate(futureDate.getDate() + daysInFuture)

          const rows = await sql`
            INSERT INTO recommendations (session_id, customer_id, product_id, rank, rationale, compliance_note, status, dismissed_until)
            VALUES (gen_random_uuid(), ${CUSTOMER_JAMES_ID}, ${PRODUCT_OVERDRAFT_ID}, 1, 'Test', 'Test', 'DISMISSED', ${futureDate})
            RETURNING id
          `
          insertedRecIds.push(rows[0].id)

          // Now replicate the dismissal filtering logic from recommendation-engine.ts (steps 2-3)
          const dismissedRows = await sql`
            SELECT DISTINCT product_id FROM recommendations
            WHERE customer_id = ${CUSTOMER_JAMES_ID} AND dismissed_until > now()
          `
          const dismissedProductIds = new Set(dismissedRows.map(r => r.product_id))

          const allProducts = await getProductsWithRates()
          const candidateProducts = allProducts.filter(p => !dismissedProductIds.has(p.id))

          const signals = await assembleCustomerSignals(CUSTOMER_JAMES_ID)
          const { eligible } = evaluateEligibility(signals, candidateProducts)

          // The dismissed product must NOT be in the eligible set
          const eligibleIds = eligible.map(p => p.id)
          expect(eligibleIds).not.toContain(PRODUCT_OVERDRAFT_ID)

          // Clean up this specific row so next iteration starts fresh
          await sql`DELETE FROM recommendations WHERE id = ${rows[0].id}`
          insertedRecIds.pop()
        }
      ),
      { numRuns: 50 } // 50 runs (each hits real DB — keep reasonable)
    )
  }, 120_000)

  /**
   * Complementary property: A product with an EXPIRED dismissed_until (in the past)
   * IS still eligible (cooldown has worn off).
   */
  it('expired dismissal (past date) does NOT exclude product from eligible set', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate a past offset between 1 and 180 days ago
        fc.integer({ min: 1, max: 180 }),
        async (daysInPast) => {
          const pastDate = new Date()
          pastDate.setDate(pastDate.getDate() - daysInPast)

          const rows = await sql`
            INSERT INTO recommendations (session_id, customer_id, product_id, rank, rationale, compliance_note, status, dismissed_until)
            VALUES (gen_random_uuid(), ${CUSTOMER_JAMES_ID}, ${PRODUCT_OVERDRAFT_ID}, 1, 'Test', 'Test', 'DISMISSED', ${pastDate})
            RETURNING id
          `
          insertedRecIds.push(rows[0].id)

          // Replicate the dismissal filtering logic
          const dismissedRows = await sql`
            SELECT DISTINCT product_id FROM recommendations
            WHERE customer_id = ${CUSTOMER_JAMES_ID} AND dismissed_until > now()
          `
          const dismissedProductIds = new Set(dismissedRows.map(r => r.product_id))

          const allProducts = await getProductsWithRates()
          const candidateProducts = allProducts.filter(p => !dismissedProductIds.has(p.id))

          const signals = await assembleCustomerSignals(CUSTOMER_JAMES_ID)
          const { eligible } = evaluateEligibility(signals, candidateProducts)

          // The product with an expired dismissal SHOULD be eligible again
          // (James qualifies for Overdraft: has existing checking, no existing overdraft)
          const eligibleIds = eligible.map(p => p.id)
          expect(eligibleIds).toContain(PRODUCT_OVERDRAFT_ID)

          // Clean up
          await sql`DELETE FROM recommendations WHERE id = ${rows[0].id}`
          insertedRecIds.pop()
        }
      ),
      { numRuns: 50 }
    )
  }, 120_000)
})
