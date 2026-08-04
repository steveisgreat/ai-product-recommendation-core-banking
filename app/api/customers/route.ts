import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db/index'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search')

  let rows
  if (search) {
    rows = await sql`
      SELECT id, full_name, household_income_band, created_at
      FROM customers
      WHERE full_name ILIKE ${'%' + search + '%'}
      ORDER BY full_name
    `
  } else {
    rows = await sql`
      SELECT id, full_name, household_income_band, created_at
      FROM customers
      ORDER BY full_name
    `
  }

  return NextResponse.json(rows)
}
