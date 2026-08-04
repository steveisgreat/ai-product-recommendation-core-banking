import { NextRequest, NextResponse } from 'next/server'
import { getProvider } from '@/lib/aggregator/index'
import { sql } from '@/lib/db/index'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const { customerId } = await params

  // Call the active aggregator provider
  const provider = getProvider()
  const accounts = await provider.getAccounts(customerId)

  // Upsert into external_accounts table for signal assembly
  if (accounts.length > 0) {
    // Delete existing external accounts for this customer, then re-insert
    await sql`DELETE FROM external_accounts WHERE customer_id = ${customerId}`
    for (const acct of accounts) {
      await sql`
        INSERT INTO external_accounts (customer_id, institution_name, account_type, masked_number, approx_balance_band, last_synced_at)
        VALUES (${customerId}, ${acct.institution_name}, ${acct.account_type}, ${acct.masked_number}, ${acct.approx_balance_band}, ${acct.last_synced_at})
      `
    }
  }

  // Always return 200 with accounts array (empty for unknown customers)
  return NextResponse.json({ accounts })
}
