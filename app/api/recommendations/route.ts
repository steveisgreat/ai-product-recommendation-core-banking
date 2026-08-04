import { NextRequest, NextResponse } from 'next/server'
import { generateRecommendations } from '@/lib/recommendation-engine'
import { LLMServiceError } from '@/lib/llm-service'

export async function POST(request: NextRequest) {
  let body: { customerId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400 }
    )
  }

  const { customerId } = body

  // Validate customerId is present and looks like a UUID
  if (!customerId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId)) {
    return NextResponse.json(
      { error: 'customerId is required and must be a valid UUID', code: 'INVALID_CUSTOMER_ID' },
      { status: 400 }
    )
  }

  try {
    const result = await generateRecommendations(customerId)

    if (!result.eligible) {
      return NextResponse.json({ eligible: false })
    }

    return NextResponse.json({
      sessionId: result.sessionId,
      recommendations: result.recommendations,
      sessionComplianceNote: result.sessionComplianceNote,
    })
  } catch (error) {
    if (error instanceof LLMServiceError) {
      console.error(`LLM Service Error [${error.code}]: ${error.message}`)
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 500 }
      )
    }
    if (error instanceof Error && error.message.startsWith('Customer not found')) {
      return NextResponse.json(
        { error: error.message, code: 'CUSTOMER_NOT_FOUND' },
        { status: 404 }
      )
    }
    console.error('Unexpected error in POST /api/recommendations:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
