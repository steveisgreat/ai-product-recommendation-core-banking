import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import { getRecommendations, validateProductMembership, LLMServiceError } from '@/lib/llm-service'
import type { CustomerSignals, Product } from '@/lib/db/types'

// Module-level mock fn that the mock factory captures
const mockCreate = vi.fn()

// Mock the Anthropic SDK with a proper class constructor
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate }
  }
  return {
    default: MockAnthropic,
    APIError: class APIError extends Error {
      constructor(status: number, message: string) {
        super(message)
        this.name = 'APIError'
      }
    },
  }
})

const mockSignals: CustomerSignals = {
  account_count: 2,
  account_types: ['CHECKING'],
  total_balance_band: '5K_25K',
  avg_monthly_inflow_band: '1K_5K',
  transaction_pattern_flags: ['RECURRING_DIRECT_DEPOSIT'],
  tenure_months: 18,
  household_income_band: 'MIDDLE',
  external_account_types: [],
  existing_product_ids: ['some-product-id'],
}

const mockProducts: Product[] = [
  {
    id: 'product-aaa-111',
    name: 'High-Yield Savings',
    account_type: 'SAVINGS',
    requires_deposit: true,
    rate: 5.25,
    eligibility_rules: [],
    description: 'High-yield savings account',
  },
  {
    id: 'product-bbb-222',
    name: 'Certificate of Deposit',
    account_type: 'CD',
    requires_deposit: true,
    rate: 6.25,
    eligibility_rules: [],
    description: '12-month CD',
  },
]

const validLLMResponse = {
  recommendations: [
    { product_id: 'product-aaa-111', rank: 1, rationale: 'Good savings option.', compliance_note: 'Used balance and inflow data.' },
    { product_id: 'product-bbb-222', rank: 2, rationale: 'CD for longer-term savings.', compliance_note: 'Used balance band.' },
  ],
  session_compliance_note: 'No protected-class attributes were used.',
}

describe('LLM Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  it('parses valid response and passes membership check', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(validLLMResponse) }],
    })

    const result = await getRecommendations(mockSignals, mockProducts)
    expect(result.recommendations).toHaveLength(2)
    expect(result.recommendations[0].product_id).toBe('product-aaa-111')
    expect(result.session_compliance_note).toBe('No protected-class attributes were used.')
  })

  it('throws INVALID_PRODUCT_ID when response contains product not in eligible set', async () => {
    const badResponse = {
      recommendations: [
        { product_id: 'NOT-IN-ELIGIBLE-SET', rank: 1, rationale: 'test', compliance_note: 'test' },
      ],
      session_compliance_note: 'test',
    }
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(badResponse) }],
    })

    await expect(getRecommendations(mockSignals, mockProducts)).rejects.toThrow(LLMServiceError)
    await expect(getRecommendations(mockSignals, mockProducts)).rejects.toMatchObject({ code: 'INVALID_PRODUCT_ID' })
  })

  it('throws PARSE_ERROR for malformed JSON response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'this is not json at all' }],
    })

    await expect(getRecommendations(mockSignals, mockProducts)).rejects.toThrow(LLMServiceError)
    await expect(getRecommendations(mockSignals, mockProducts)).rejects.toMatchObject({ code: 'PARSE_ERROR' })
  })

  it('throws TIMEOUT when request is aborted', async () => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    mockCreate.mockRejectedValue(abortErr)

    await expect(getRecommendations(mockSignals, mockProducts)).rejects.toThrow(LLMServiceError)
    await expect(getRecommendations(mockSignals, mockProducts)).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('handles markdown code fence wrapped JSON response', async () => {
    const fencedResponse = '```json\n' + JSON.stringify(validLLMResponse) + '\n```'
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: fencedResponse }],
    })

    const result = await getRecommendations(mockSignals, mockProducts)
    expect(result.recommendations).toHaveLength(2)
    expect(result.recommendations[0].product_id).toBe('product-aaa-111')
    expect(result.session_compliance_note).toBe('No protected-class attributes were used.')
  })

  it('throws SCHEMA_ERROR when response structure is invalid', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ recommendations: [], session_compliance_note: 'test' }) }],
    })

    // Empty recommendations array should fail min(1) validation
    await expect(getRecommendations(mockSignals, mockProducts)).rejects.toThrow(LLMServiceError)
    await expect(getRecommendations(mockSignals, mockProducts)).rejects.toMatchObject({ code: 'SCHEMA_ERROR' })
  })
})

describe('validateProductMembership', () => {
  it('does not throw when all product_ids are in eligible set', () => {
    const parsed = { ...validLLMResponse }
    expect(() => validateProductMembership(parsed, mockProducts)).not.toThrow()
  })

  it('throws for product_id not in eligible set', () => {
    const parsed = {
      recommendations: [{ product_id: 'fake-id', rank: 1, rationale: 'x', compliance_note: 'x' }],
      session_compliance_note: 'x',
    }
    expect(() => validateProductMembership(parsed, mockProducts)).toThrow(LLMServiceError)
    expect(() => validateProductMembership(parsed, mockProducts)).toThrow('not in the eligible set')
  })
})


// ─── LLM Service — Property-Based Tests ─────────────────────────────────────────

describe('LLM Service - Property-Based Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })

  /**
   * Property: Any response containing a product_id NOT in the eligible set
   * always throws LLMServiceError('INVALID_PRODUCT_ID').
   */
  it('any random product_id outside eligible set always throws INVALID_PRODUCT_ID', () => {
    fc.assert(
      fc.property(
        fc.uuid(),
        (randomProductId) => {
          // Ensure the random ID is NOT in the eligible set
          if (mockProducts.some(p => p.id === randomProductId)) return true // skip collisions

          const parsed = {
            recommendations: [
              { product_id: randomProductId, rank: 1, rationale: 'test', compliance_note: 'test' },
            ],
            session_compliance_note: 'test',
          }

          expect(() => validateProductMembership(parsed, mockProducts)).toThrow(LLMServiceError)
          return true
        }
      ),
      { numRuns: 100 }
    )
  })

  /**
   * Property: Responses with out-of-range ranks (< 1 or > 3) are rejected by
   * RecommendationOutputSchema (Zod validation), verified via getRecommendations
   * which parses the response with the schema.
   */
  it('out-of-range ranks are rejected by schema validation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: -10, max: 0 }).chain(badRank =>
          fc.constant(badRank)
        ),
        async (badRank) => {
          const badResponse = {
            recommendations: [
              { product_id: 'product-aaa-111', rank: badRank, rationale: 'test', compliance_note: 'test' },
            ],
            session_compliance_note: 'test',
          }
          mockCreate.mockResolvedValue({
            content: [{ type: 'text', text: JSON.stringify(badResponse) }],
          })

          await expect(getRecommendations(mockSignals, mockProducts)).rejects.toMatchObject({ code: 'SCHEMA_ERROR' })
        }
      ),
      { numRuns: 50 }
    )
  })

  /**
   * Property: Responses with rank > 3 are rejected by schema validation.
   */
  it('ranks above 3 are rejected by schema validation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 4, max: 100 }),
        async (badRank) => {
          const badResponse = {
            recommendations: [
              { product_id: 'product-aaa-111', rank: badRank, rationale: 'test', compliance_note: 'test' },
            ],
            session_compliance_note: 'test',
          }
          mockCreate.mockResolvedValue({
            content: [{ type: 'text', text: JSON.stringify(badResponse) }],
          })

          await expect(getRecommendations(mockSignals, mockProducts)).rejects.toMatchObject({ code: 'SCHEMA_ERROR' })
        }
      ),
      { numRuns: 50 }
    )
  })
})
