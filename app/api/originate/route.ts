import { NextRequest, NextResponse } from 'next/server'
import { originateAccount, OriginationError } from '@/lib/origination-service'

export async function POST(request: NextRequest) {
  let body: {
    recommendationId?: string
    customerId?: string
    productId?: string
    depositAmount?: number
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400 }
    )
  }

  const { recommendationId, customerId, productId, depositAmount } = body

  // Validate required fields
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  if (!recommendationId || !uuidRegex.test(recommendationId)) {
    return NextResponse.json(
      { error: 'recommendationId is required and must be a valid UUID', code: 'INVALID_RECOMMENDATION_ID' },
      { status: 400 }
    )
  }
  if (!customerId || !uuidRegex.test(customerId)) {
    return NextResponse.json(
      { error: 'customerId is required and must be a valid UUID', code: 'INVALID_CUSTOMER_ID' },
      { status: 400 }
    )
  }
  if (!productId || !uuidRegex.test(productId)) {
    return NextResponse.json(
      { error: 'productId is required and must be a valid UUID', code: 'INVALID_PRODUCT_ID' },
      { status: 400 }
    )
  }
  if (depositAmount === undefined || depositAmount === null || typeof depositAmount !== 'number') {
    return NextResponse.json(
      { error: 'depositAmount is required and must be a number', code: 'INVALID_DEPOSIT_AMOUNT' },
      { status: 400 }
    )
  }

  try {
    const result = await originateAccount({
      customerId,
      productId,
      recommendationId,
      depositAmount,
    })

    if (!result.success && 'notEligible' in result) {
      return NextResponse.json(
        { error: 'Product is no longer eligible for this customer', code: 'NOT_ELIGIBLE' },
        { status: 422 }
      )
    }

    if (!result.success && 'duplicate' in result) {
      return NextResponse.json(
        { duplicate: true, existingAccount: result.existingAccount },
        { status: 200 }
      )
    }

    if (result.success) {
      return NextResponse.json(
        { account: result.account },
        { status: 201 }
      )
    }
  } catch (error) {
    if (error instanceof OriginationError) {
      if (error.code === 'DEPOSIT_REQUIRED' || error.code === 'DEPOSIT_NOT_ALLOWED') {
        return NextResponse.json(
          { error: error.message, code: error.code },
          { status: 422 }
        )
      }
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 500 }
      )
    }
    console.error('Unexpected error in POST /api/originate:', error)
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    )
  }
}
