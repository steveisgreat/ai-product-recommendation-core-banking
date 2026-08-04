import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import * as fc from 'fast-check'
import { originateAccount, OriginationError } from '@/lib/origination-service'
import { sql } from '@/lib/db/index'

// Seeded IDs
const CUSTOMER_PRIYA_ID = '20000000-0000-0000-0000-000000000003'
const PRODUCT_CD_ID = '10000000-0000-0000-0000-000000000003'
const PRODUCT_CREDIT_CARD_ID = '10000000-0000-0000-0000-000000000005'
const PRODUCT_CHECKING_ID = '10000000-0000-0000-0000-000000000001'
const CUSTOMER_JAMES_ID = '20000000-0000-0000-0000-000000000002'

// We need a recommendation row to reference — create a fake one for testing
let testRecommendationId: string
let testRecommendationId2: string

beforeAll(async () => {
  // Create test recommendation rows for Priya (CD) that we can originate against
  const rows = await sql`
    INSERT INTO recommendations (session_id, customer_id, product_id, rank, rationale, compliance_note, status)
    VALUES 
      (gen_random_uuid(), ${CUSTOMER_PRIYA_ID}, ${PRODUCT_CD_ID}, 1, 'Test rationale', 'Test note', 'PENDING'),
      (gen_random_uuid(), ${CUSTOMER_PRIYA_ID}, ${PRODUCT_CD_ID}, 1, 'Test rationale 2', 'Test note 2', 'PENDING')
    RETURNING id
  `
  testRecommendationId = rows[0].id
  testRecommendationId2 = rows[1].id
})

afterAll(async () => {
  // Clean up test data: remove any accounts/transactions/recommendations we created
  // 1. Clear originated_account_id FK on ALL recommendations pointing to our test accounts
  await sql`
    UPDATE recommendations
    SET originated_account_id = NULL
    WHERE originated_account_id IN (
      SELECT id FROM accounts WHERE customer_id = ${CUSTOMER_PRIYA_ID} AND product_id = ${PRODUCT_CD_ID}
    )
  `
  // 2. Delete transactions (FK to accounts)
  await sql`
    DELETE FROM transactions WHERE account_id IN (
      SELECT id FROM accounts WHERE customer_id = ${CUSTOMER_PRIYA_ID} AND product_id = ${PRODUCT_CD_ID}
    )
  `
  // 3. Delete test accounts
  await sql`
    DELETE FROM accounts WHERE customer_id = ${CUSTOMER_PRIYA_ID} AND product_id = ${PRODUCT_CD_ID}
  `
  // 4. Delete test recommendations
  await sql`
    DELETE FROM recommendations WHERE id IN (${testRecommendationId}, ${testRecommendationId2})
  `
  await sql.end()
})

describe('Origination Service', () => {
  it('successfully originates an account with valid deposit for a deposit product', async () => {
    const result = await originateAccount({
      customerId: CUSTOMER_PRIYA_ID,
      productId: PRODUCT_CD_ID,
      recommendationId: testRecommendationId,
      depositAmount: 10000,
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.account.customer_id).toBe(CUSTOMER_PRIYA_ID)
      expect(result.account.product_id).toBe(PRODUCT_CD_ID)
      expect(result.account.balance).toBe(10000)
      expect(result.account.status).toBe('ACTIVE')
      expect(result.account.account_number).toMatch(/^\d{10}$/)

      // Verify transaction was created
      const txns = await sql`
        SELECT * FROM transactions WHERE account_id = ${result.account.id}
      `
      expect(txns).toHaveLength(1)
      expect(txns[0].type).toBe('ACCOUNT_OPEN')
      expect(Number(txns[0].amount)).toBe(10000)

      // Verify recommendation was updated
      const recs = await sql`
        SELECT * FROM recommendations WHERE id = ${testRecommendationId}
      `
      expect(recs[0].status).toBe('ORIGINATED')
      expect(recs[0].originated_account_id).toBe(result.account.id)
    }
  })

  it('detects duplicate when originating same customer+product twice', async () => {
    // The first origination succeeded above — now try again
    const result = await originateAccount({
      customerId: CUSTOMER_PRIYA_ID,
      productId: PRODUCT_CD_ID,
      recommendationId: testRecommendationId2,
      depositAmount: 5000,
    })

    expect(result.success).toBe(false)
    if (!result.success && 'duplicate' in result) {
      expect(result.duplicate).toBe(true)
      expect(result.existingAccount.customer_id).toBe(CUSTOMER_PRIYA_ID)
      expect(result.existingAccount.product_id).toBe(PRODUCT_CD_ID)
    }
  })

  it('throws DEPOSIT_REQUIRED when deposit product gets depositAmount <= 0', async () => {
    await expect(
      originateAccount({
        customerId: CUSTOMER_PRIYA_ID,
        productId: PRODUCT_CD_ID,
        recommendationId: testRecommendationId,
        depositAmount: 0,
      })
    ).rejects.toThrow(OriginationError)

    await expect(
      originateAccount({
        customerId: CUSTOMER_PRIYA_ID,
        productId: PRODUCT_CD_ID,
        recommendationId: testRecommendationId,
        depositAmount: 0,
      })
    ).rejects.toMatchObject({ code: 'DEPOSIT_REQUIRED' })
  })

  it('throws DEPOSIT_NOT_ALLOWED when non-deposit product gets depositAmount > 0', async () => {
    // Credit card is requires_deposit: false
    await expect(
      originateAccount({
        customerId: CUSTOMER_PRIYA_ID,
        productId: PRODUCT_CREDIT_CARD_ID,
        recommendationId: testRecommendationId,
        depositAmount: 100,
      })
    ).rejects.toThrow(OriginationError)

    await expect(
      originateAccount({
        customerId: CUSTOMER_PRIYA_ID,
        productId: PRODUCT_CREDIT_CARD_ID,
        recommendationId: testRecommendationId,
        depositAmount: 100,
      })
    ).rejects.toMatchObject({ code: 'DEPOSIT_NOT_ALLOWED' })
  })

  it('returns notEligible when product fails eligibility re-check', async () => {
    // James already has a checking account, so CHECKING product should fail
    // the NO_EXISTING_CHECKING rule
    const result = await originateAccount({
      customerId: CUSTOMER_JAMES_ID,
      productId: PRODUCT_CHECKING_ID,
      recommendationId: testRecommendationId,
      depositAmount: 100,
    })

    expect(result.success).toBe(false)
    if (!result.success && 'notEligible' in result) {
      expect(result.notEligible).toBe(true)
    }
  })

  it('no DB rows written when deposit validation fails', async () => {
    const accountsBefore = await sql`SELECT count(*) as n FROM accounts`
    const txnsBefore = await sql`SELECT count(*) as n FROM transactions`

    try {
      await originateAccount({
        customerId: CUSTOMER_PRIYA_ID,
        productId: PRODUCT_CD_ID,
        recommendationId: testRecommendationId,
        depositAmount: -50,
      })
    } catch {
      // Expected to throw
    }

    const accountsAfter = await sql`SELECT count(*) as n FROM accounts`
    const txnsAfter = await sql`SELECT count(*) as n FROM transactions`

    expect(Number(accountsAfter[0].n)).toBe(Number(accountsBefore[0].n))
    expect(Number(txnsAfter[0].n)).toBe(Number(txnsBefore[0].n))
  })
})

// ─── Property-Based Tests ──────────────────────────────────────────────────────

describe('Origination Service - Property-Based Tests', () => {
  /**
   * Property 1: Originating the same (customerId, productId) twice always
   * results in duplicate detection on the second call — no second account created.
   *
   * Strategy: After the first successful origination (from the integration tests above),
   * try originating with varied depositAmounts. Every attempt should return duplicate.
   */
  it('duplicate detection holds for any depositAmount on second origination attempt', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100000 }),
        async (depositAmount) => {
          const result = await originateAccount({
            customerId: CUSTOMER_PRIYA_ID,
            productId: PRODUCT_CD_ID,
            recommendationId: testRecommendationId2,
            depositAmount,
          })
          // Must always detect duplicate — never succeed
          expect(result.success).toBe(false)
          if (!result.success && 'duplicate' in result) {
            expect(result.duplicate).toBe(true)
          }
        }
      ),
      { numRuns: 100 }
    )
  }, 120_000)

  /**
   * Property 2: If requires_deposit = true and depositAmount <= 0,
   * no DB rows are ever written (throws before any DB operation).
   *
   * Strategy: Generate various non-positive amounts and verify row counts don't change.
   */
  it('no DB rows written for any non-positive depositAmount on a deposit product', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -10000, max: 0 }),
        async (depositAmount) => {
          const accountsBefore = await sql`SELECT count(*) as n FROM accounts`
          const txnsBefore = await sql`SELECT count(*) as n FROM transactions`

          try {
            await originateAccount({
              customerId: CUSTOMER_PRIYA_ID,
              productId: PRODUCT_CD_ID,
              recommendationId: testRecommendationId,
              depositAmount,
            })
          } catch (err) {
            expect(err).toBeInstanceOf(OriginationError)
            expect((err as OriginationError).code).toBe('DEPOSIT_REQUIRED')
          }

          const accountsAfter = await sql`SELECT count(*) as n FROM accounts`
          const txnsAfter = await sql`SELECT count(*) as n FROM transactions`

          expect(Number(accountsAfter[0].n)).toBe(Number(accountsBefore[0].n))
          expect(Number(txnsAfter[0].n)).toBe(Number(txnsBefore[0].n))
        }
      ),
      { numRuns: 100 }
    )
  }, 120_000)

  /**
   * Property 3: If requires_deposit = false and depositAmount !== 0,
   * no DB rows are ever written (throws before any DB operation).
   *
   * Strategy: Generate various non-zero amounts for a non-deposit product (Credit Card)
   * and verify row counts don't change.
   */
  it('no DB rows written for any non-zero depositAmount on a non-deposit product', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 50000 }),
        async (depositAmount) => {
          const accountsBefore = await sql`SELECT count(*) as n FROM accounts`
          const txnsBefore = await sql`SELECT count(*) as n FROM transactions`

          try {
            await originateAccount({
              customerId: CUSTOMER_PRIYA_ID,
              productId: PRODUCT_CREDIT_CARD_ID,
              recommendationId: testRecommendationId,
              depositAmount,
            })
          } catch (err) {
            expect(err).toBeInstanceOf(OriginationError)
            expect((err as OriginationError).code).toBe('DEPOSIT_NOT_ALLOWED')
          }

          const accountsAfter = await sql`SELECT count(*) as n FROM accounts`
          const txnsAfter = await sql`SELECT count(*) as n FROM transactions`

          expect(Number(accountsAfter[0].n)).toBe(Number(accountsBefore[0].n))
          expect(Number(txnsAfter[0].n)).toBe(Number(txnsBefore[0].n))
        }
      ),
      { numRuns: 100 }
    )
  }, 120_000)
})
