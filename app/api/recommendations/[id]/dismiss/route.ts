import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db/index'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const recommendationId = id

  // Fetch the recommendation row
  const rows = await sql`
    SELECT * FROM recommendations WHERE id = ${recommendationId}
  `

  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'Recommendation not found', code: 'NOT_FOUND' },
      { status: 404 }
    )
  }

  const recommendation = rows[0]

  // Can only dismiss PENDING recommendations
  if (recommendation.status !== 'PENDING') {
    return NextResponse.json(
      { error: `Cannot dismiss recommendation with status "${recommendation.status}"`, code: 'CONFLICT' },
      { status: 409 }
    )
  }

  // Update status and set dismissed_until to now + 90 days
  const updated = await sql`
    UPDATE recommendations
    SET status = 'DISMISSED', dismissed_until = now() + interval '90 days'
    WHERE id = ${recommendationId}
    RETURNING *
  `

  return NextResponse.json(updated[0])
}
