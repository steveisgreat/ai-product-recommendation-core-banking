/**
 * lib/llm-service.ts
 * 
 * Wraps the Anthropic SDK. Model: claude-haiku-4-5-20251001.
 * Validates output with Zod + post-parse product membership check.
 */
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { CustomerSignals, Product } from '@/lib/db/types'

// Custom error class
export class LLMServiceError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'LLMServiceError'
    this.code = code
  }
}

// Zod schema for Claude's response
export const RecommendationOutputSchema = z.object({
  recommendations: z.array(z.object({
    product_id: z.string(),
    rank: z.number().int().min(1).max(3),
    rationale: z.string().max(600),
    compliance_note: z.string(),
  })).min(1).max(3),
  session_compliance_note: z.string(),
})

export type RecommendationOutput = z.infer<typeof RecommendationOutputSchema>

// Post-parse membership validation
export function validateProductMembership(
  parsed: RecommendationOutput,
  eligibleProducts: Product[]
): void {
  const eligibleIds = new Set(eligibleProducts.map(p => p.id))
  for (const rec of parsed.recommendations) {
    if (!eligibleIds.has(rec.product_id)) {
      throw new LLMServiceError(
        `LLM returned product_id ${rec.product_id} which is not in the eligible set`,
        'INVALID_PRODUCT_ID'
      )
    }
  }
}

const SYSTEM_PROMPT = `You are a banking product recommendation assistant. You will receive a JSON object with anonymized customer financial signals and a list of eligible products.

Rules you must follow without exception:
- Use ONLY the fields provided in the input JSON. Do not infer or reference any information not present.
- Never reference or imply any protected-class characteristics (race, color, religion, national origin, sex, marital status, age, or receipt of public assistance) in rationale or compliance notes.
- Rank products by relevance to the customer's financial signals only — not by bank profitability or promotional status.
- Rationale must be 1–2 plain-English sentences a banker could read aloud to a customer.
- Output strict JSON only — no text outside the JSON object.
- You may only recommend products from the eligible_products list provided. Do not introduce or reference any product not in that list.

Output schema:
{
  "recommendations": [
    { "product_id": "uuid", "rank": 1, "rationale": "string", "compliance_note": "string" }
  ],
  "session_compliance_note": "string"
}`

export async function getRecommendations(
  signals: CustomerSignals,
  eligibleProducts: Product[]
): Promise<RecommendationOutput> {
  const client = new Anthropic()

  const userPayload = JSON.stringify({
    customer_signals: {
      account_count: signals.account_count,
      account_types: signals.account_types,
      total_balance_band: signals.total_balance_band,
      avg_monthly_inflow_band: signals.avg_monthly_inflow_band,
      transaction_pattern_flags: signals.transaction_pattern_flags,
      tenure_months: signals.tenure_months,
      household_income_band: signals.household_income_band,
      external_account_types: signals.external_account_types,
    },
    eligible_products: eligibleProducts.map(p => ({
      id: p.id,
      name: p.name,
      account_type: p.account_type,
      rate: p.rate,
      description: p.description,
    })),
  })

  // 10-second timeout
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPayload }],
    }, { signal: controller.signal })

    clearTimeout(timeout)

    // Extract text content from response
    const textBlock = response.content.find(block => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      throw new LLMServiceError('No text content in Claude response', 'NO_CONTENT')
    }

    // Strip markdown code fence if present (Claude sometimes wraps JSON in ```json ... ```)
    let rawText = textBlock.text.trim()
    if (rawText.startsWith('```')) {
      // Remove opening fence (```json or ```)
      rawText = rawText.replace(/^```(?:json)?\s*\n?/, '')
      // Remove closing fence
      rawText = rawText.replace(/\n?```\s*$/, '')
      rawText = rawText.trim()
    }

    // Parse JSON from response
    let jsonData: unknown
    try {
      jsonData = JSON.parse(rawText)
    } catch {
      throw new LLMServiceError(
        `Failed to parse Claude response as JSON: ${rawText.substring(0, 200)}`,
        'PARSE_ERROR'
      )
    }

    // Validate with Zod
    const parseResult = RecommendationOutputSchema.safeParse(jsonData)
    if (!parseResult.success) {
      throw new LLMServiceError(
        `Claude response failed schema validation: ${parseResult.error.message}`,
        'SCHEMA_ERROR'
      )
    }

    // Validate product membership — NEVER skip this
    validateProductMembership(parseResult.data, eligibleProducts)

    return parseResult.data
  } catch (error) {
    clearTimeout(timeout)
    if (error instanceof LLMServiceError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LLMServiceError('Claude API request timed out after 10 seconds', 'TIMEOUT')
    }
    if (error instanceof Anthropic.APIError) {
      throw new LLMServiceError(`Claude API error: ${error.message}`, 'API_ERROR')
    }
    throw new LLMServiceError(
      `Unexpected error calling Claude: ${error instanceof Error ? error.message : String(error)}`,
      'UNKNOWN'
    )
  }
}
