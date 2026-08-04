import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db/index'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const customerId = id

  // Fetch all recommendations for this customer, ordered by session
  const rows = await sql`
    SELECT
      r.id,
      r.session_id,
      r.created_at,
      r.product_id,
      r.rank,
      r.rationale,
      r.compliance_note,
      r.status,
      r.originated_account_id,
      r.dismissed_until,
      r.session_compliance_note,
      p.name as product_name,
      p.account_type as product_account_type
    FROM recommendations r
    JOIN products p ON p.id = r.product_id
    WHERE r.customer_id = ${customerId}
    ORDER BY r.created_at DESC, r.rank ASC
  `

  // Group by session_id
  const sessionsMap = new Map<string, {
    session_id: string
    created_at: string
    sessionComplianceNote: string
    recommendations: Array<{
      id: string
      product_id: string
      product_name: string
      product_account_type: string
      rank: number
      rationale: string
      compliance_note: string
      status: string
      originated_account_id: string | null
      dismissed_until: string | null
    }>
  }>()

  for (const row of rows) {
    if (!sessionsMap.has(row.session_id)) {
      sessionsMap.set(row.session_id, {
        session_id: row.session_id,
        created_at: row.created_at,
        sessionComplianceNote: row.session_compliance_note || '',
        recommendations: [],
      })
    }
    sessionsMap.get(row.session_id)!.recommendations.push({
      id: row.id,
      product_id: row.product_id,
      product_name: row.product_name,
      product_account_type: row.product_account_type,
      rank: row.rank,
      rationale: row.rationale,
      compliance_note: row.compliance_note,
      status: row.status,
      originated_account_id: row.originated_account_id,
      dismissed_until: row.dismissed_until,
    })
  }

  const sessions = Array.from(sessionsMap.values())

  return NextResponse.json(sessions)
}
