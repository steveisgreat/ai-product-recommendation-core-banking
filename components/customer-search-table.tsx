"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

interface Customer {
  id: string
  full_name: string
  household_income_band: string
  created_at: string
  account_count: number
}

interface CustomerSearchTableProps {
  customers: Customer[]
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
  })
}

function formatIncomeBand(band: string): string {
  return band
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

export function CustomerSearchTable({ customers }: CustomerSearchTableProps) {
  const [search, setSearch] = useState("")
  const router = useRouter()

  const filtered = customers.filter((c) =>
    c.full_name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search customers by name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
        aria-label="Search customers"
      />
      <div className="rounded-md border">
        <Table>
          <TableCaption>List of customers — click a row to view their profile</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Income Band</TableHead>
              <TableHead className="text-right">Accounts</TableHead>
              <TableHead>Member Since</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No customers found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((customer) => (
                <TableRow
                  key={customer.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/customers/${customer.id}`)}
                  tabIndex={0}
                  aria-label={`View profile for ${customer.full_name}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      router.push(`/customers/${customer.id}`)
                    }
                  }}
                >
                  <TableCell className="font-medium">{customer.full_name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{formatIncomeBand(customer.household_income_band)}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{customer.account_count}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(customer.created_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {filtered.length} of {customers.length} customers shown
      </p>
    </div>
  )
}
