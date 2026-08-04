import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db/index'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Fetch customer
  const customers = await sql`
    SELECT * FROM customers WHERE id = ${id}
  `
  if (customers.length === 0) {
    return NextResponse.json(
      { error: 'Customer not found', code: 'NOT_FOUND' },
      { status: 404 }
    )
  }
  const customer = customers[0]

  // Fetch accounts
  const accounts = await sql`
    SELECT * FROM accounts WHERE customer_id = ${id} ORDER BY opened_at DESC
  `

  // Compute transaction summary
  const accountIds = accounts.map(a => a.id)
  let transactionSummary = { totalDebits: 0, totalCredits: 0, avgMonthlyInflow: 0 }

  if (accountIds.length > 0) {
    const summary = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE 0 END), 0) as total_debits,
        COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE 0 END), 0) as total_credits
      FROM transactions
      WHERE account_id = ANY(${accountIds})
    `

    const threeMonthsAgo = new Date()
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

    const recentCredits = await sql`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM transactions
      WHERE account_id = ANY(${accountIds})
        AND type = 'CREDIT'
        AND posted_at >= ${threeMonthsAgo}
    `

    transactionSummary = {
      totalDebits: Number(summary[0].total_debits),
      totalCredits: Number(summary[0].total_credits),
      avgMonthlyInflow: Math.round(Number(recentCredits[0].total) / 3 * 100) / 100,
    }
  }

  return NextResponse.json({
    customer,
    accounts,
    transactionSummary,
  })
}
