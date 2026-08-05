import { sql } from "@/lib/db/index"
import { notFound } from "next/navigation"
import { CustomerProfileCard } from "@/components/customer-profile-card"
import { CoreAccountsPanel } from "@/components/core-accounts-panel"
import { ExternalAccountsPanel } from "@/components/external-accounts-panel"
import { RecommendationPanel } from "@/components/recommendation-panel"
import Link from "next/link"

export const dynamic = "force-dynamic"

interface Props {
  params: Promise<{ id: string }>
}

export default async function CustomerProfilePage({ params }: Props) {
  const { id } = await params

  // Fetch customer
  const customers = await sql`SELECT * FROM customers WHERE id = ${id}`
  if (customers.length === 0) {
    notFound()
  }
  const customer = customers[0]

  // Fetch accounts
  const accounts = await sql`
    SELECT * FROM accounts WHERE customer_id = ${id} ORDER BY opened_at DESC
  ` as unknown as { id: string; account_type: string; account_number: string; balance: number | string; status: string; opened_at: string; customer_id: string }[]

  // Compute tenure in months
  const earliestAccount = accounts.length > 0
    ? accounts.reduce((earliest, a) =>
        new Date(a.opened_at) < new Date(earliest.opened_at) ? a : earliest
      )
    : null
  const tenureMonths = earliestAccount
    ? Math.floor((Date.now() - new Date(earliestAccount.opened_at).getTime()) / (1000 * 60 * 60 * 24 * 30.44))
    : 0

  return (
    <div className="p-6 space-y-6">
      {/* Back link */}
      <Link
        href="/customers"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        Back to Customers
      </Link>

      {/* Profile card */}
      <CustomerProfileCard
        fullName={customer.full_name}
        householdSize={customer.household_size}
        incomeBand={customer.household_income_band}
        tenureMonths={tenureMonths}
        memberSince={customer.created_at}
      />

      {/* Two-column layout for accounts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Core accounts */}
        <CoreAccountsPanel accounts={accounts} />

        {/* External accounts (client-side, non-blocking) */}
        <ExternalAccountsPanel customerId={id} />
      </div>

      {/* Recommendation panel */}
      <RecommendationPanel customerId={id} />
    </div>
  )
}
