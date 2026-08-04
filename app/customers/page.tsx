import { sql } from "@/lib/db/index"
import { CustomerSearchTable } from "@/components/customer-search-table"

export const dynamic = "force-dynamic"

interface CustomerRow {
  id: string
  full_name: string
  household_income_band: string
  created_at: string
  account_count: number
}

export default async function CustomersPage() {
  const customers = await sql<CustomerRow[]>`
    SELECT
      c.id,
      c.full_name,
      c.household_income_band,
      c.created_at,
      COUNT(a.id)::int as account_count
    FROM customers c
    LEFT JOIN accounts a ON a.customer_id = c.id AND a.status = 'ACTIVE'
    GROUP BY c.id
    ORDER BY c.full_name
  `

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select a customer to view their profile and generate product recommendations.
        </p>
      </div>
      <CustomerSearchTable customers={customers} />
    </div>
  )
}
