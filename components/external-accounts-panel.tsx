"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface ExternalAccount {
  institution_name: string
  account_type: string
  masked_number: string
  approx_balance_band: string
  last_synced_at: string
}

interface ExternalAccountsPanelProps {
  customerId: string
}

function formatBalanceBand(band: string): string {
  switch (band) {
    case "UNDER_1K": return "< $1K"
    case "1K_5K": return "$1K–$5K"
    case "5K_25K": return "$5K–$25K"
    case "25K_100K": return "$25K–$100K"
    case "OVER_100K": return "$100K+"
    default: return band
  }
}

function formatAccountType(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

export function ExternalAccountsPanel({ customerId }: ExternalAccountsPanelProps) {
  const [accounts, setAccounts] = useState<ExternalAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000) // 3-second timeout

    fetch(`/api/mock-aggregator/${customerId}`, { signal: controller.signal })
      .then((res) => {
        clearTimeout(timeout)
        if (!res.ok) throw new Error(`Status ${res.status}`)
        return res.json()
      })
      .then((data) => {
        setAccounts(data.accounts || [])
        setLoading(false)
      })
      .catch((err) => {
        clearTimeout(timeout)
        if (err.name === "AbortError") {
          setError("External account data timed out. Core account data is still available above.")
        } else {
          setError("External account data is temporarily unavailable.")
        }
        setLoading(false)
      })

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [customerId])

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          Linked External Accounts
          <Badge variant="info" className="text-[10px]">External</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}

        {error && (
          <Alert variant="warning">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!loading && !error && accounts.length === 0 && (
          <p className="text-sm text-muted-foreground">No linked external accounts.</p>
        )}

        {!loading && !error && accounts.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Institution</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Last 4</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((acct, i) => (
                <TableRow key={`${acct.institution_name}-${acct.masked_number}-${i}`}>
                  <TableCell className="font-medium">{acct.institution_name}</TableCell>
                  <TableCell>{formatAccountType(acct.account_type)}</TableCell>
                  <TableCell className="font-mono text-xs">••••{acct.masked_number}</TableCell>
                  <TableCell className="text-right">
                    <Badge variant="neutral">{formatBalanceBand(acct.approx_balance_band)}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
