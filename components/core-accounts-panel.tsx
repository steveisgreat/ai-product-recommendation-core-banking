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

interface Account {
  id: string
  account_type: string
  account_number: string
  balance: number | string
  status: string
  opened_at: string
}

interface CoreAccountsPanelProps {
  accounts: Account[]
}

function formatCurrency(amount: number | string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(amount))
}

function formatAccountType(type: string): string {
  return type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

export function CoreAccountsPanel({ accounts }: CoreAccountsPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Core Accounts</CardTitle>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts on file.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Account #</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Opened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell className="font-medium">
                    {formatAccountType(account.account_type)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {account.account_number}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(account.balance)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={account.status === "ACTIVE" ? "success" : "secondary"}>
                      {account.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(account.opened_at).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
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
