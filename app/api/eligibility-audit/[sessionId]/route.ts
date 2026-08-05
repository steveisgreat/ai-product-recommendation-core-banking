import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db/index'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params

  const rows = await sql`
    SELECT
      ea.id,
      ea.session_id,
      ea.customer_id,
      ea.product_id,
      ea.rules_evaluated,
      ea.overall_eligible,
      ea.evaluated_at,
      p.name as product_name
    FROM eligibility_audit ea
    JOIN products p ON p.id = ea.product_id
    WHERE ea.session_id = ${sessionId}
    ORDER BY p.name
  `

  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'No audit records found for this session', code: 'NOT_FOUND' },
      { status: 404 }
    )
  }

  // Parse rules_evaluated from JSON string if needed (postgres driver may return it as a string)
  const parsed = rows.map(row => ({
    ...row,
    rules_evaluated: typeof row.rules_evaluated === 'string'
      ? JSON.parse(row.rules_evaluated)
      : row.rules_evaluated,
  }))

  return NextResponse.json(parsed)
}
