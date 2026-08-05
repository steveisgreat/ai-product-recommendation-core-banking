/**
 * lib/recommendation-engine.ts
 * 
 * Orchestrates: signals → dismissal filter → eligibility → LLM → persist.
 * LLM errors propagate without partial DB writes.
 */
import { sql } from '@/lib/db/index'
import { assembleCustomerSignals } from '@/lib/db/assemble-signals'
import { evaluateEligibility } from '@/lib/eligibility-engine'
import { getProductsWithRates } from '@/lib/products-with-rates'
import { getRecommendations, type RecommendationOutput } from '@/lib/llm-service'
import { v4 as uuidv4 } from 'uuid'
import type { Product } from '@/lib/db/types'
import type { AuditRecord } from '@/lib/eligibility-engine'

export interface RecommendationWithId {
  id: string
  product_id: string
  rank: number
  rationale: string
  compliance_note: string
}

export type RecommendationEngineResult = {
  eligible: false
} | {
  eligible: true
  sessionId: string
  recommendations: RecommendationWithId[]
  sessionComplianceNote: string
}

export async function generateRecommendations(
  customerId: string
): Promise<RecommendationEngineResult> {
  // Step 1: Assemble anonymized signals
  const signals = await assembleCustomerSignals(customerId)

  // Step 2: Query active dismissals and exclude those product_ids
  const dismissedRows = await sql`
    SELECT DISTINCT product_id FROM recommendations
    WHERE customer_id = ${customerId} AND dismissed_until > now()
  `
  const dismissedProductIds = new Set(dismissedRows.map(r => r.product_id))

  // Step 3: Get live-rated products, filter out dismissed ones
  const allProducts = await getProductsWithRates()
  const candidateProducts = allProducts.filter(p => !dismissedProductIds.has(p.id))

  // Run eligibility evaluation
  const { eligible, audit } = evaluateEligibility(signals, candidateProducts)

  // Step 4: If no eligible products, return early — do NOT call LLM
  if (eligible.length === 0) {
    return { eligible: false }
  }

  // Step 5: Call LLM with eligible products (already carry live FRED rates)
  const llmResult = await getRecommendations(signals, eligible)

  // Step 6: Generate session_id
  const sessionId = uuidv4()

  // Step 7: Persist in a single DB transaction
  const insertedRecs: RecommendationWithId[] = []
  await sql.begin(async (tx) => {
    // Insert recommendation rows (1–3) with RETURNING id
    for (const rec of llmResult.recommendations) {
      const rows = await tx`
        INSERT INTO recommendations (session_id, customer_id, product_id, rank, rationale, compliance_note, session_compliance_note, status)
        VALUES (${sessionId}, ${customerId}, ${rec.product_id}, ${rec.rank}, ${rec.rationale}, ${rec.compliance_note}, ${llmResult.session_compliance_note}, 'PENDING')
        RETURNING id
      `
      insertedRecs.push({
        id: rows[0].id,
        product_id: rec.product_id,
        rank: rec.rank,
        rationale: rec.rationale,
        compliance_note: rec.compliance_note,
      })
    }

    // Insert eligibility_audit rows (one per product evaluated)
    // Group audit records by product_id
    const auditByProduct = new Map<string, AuditRecord[]>()
    for (const record of audit) {
      const existing = auditByProduct.get(record.product_id) || []
      existing.push(record)
      auditByProduct.set(record.product_id, existing)
    }

    for (const [productId, records] of auditByProduct) {
      const overallEligible = records.every(r => r.passed)
      await tx`
        INSERT INTO eligibility_audit (session_id, customer_id, product_id, rules_evaluated, overall_eligible)
        VALUES (${sessionId}, ${customerId}, ${productId}, ${JSON.stringify(records)}, ${overallEligible})
      `
    }
  })

  // Step 8: Return results (with DB-generated recommendation IDs)
  return {
    eligible: true,
    sessionId,
    recommendations: insertedRecs,
    sessionComplianceNote: llmResult.session_compliance_note,
  }
}
