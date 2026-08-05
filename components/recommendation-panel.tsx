"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog"

interface Recommendation {
  product_id: string
  rank: number
  rationale: string
  compliance_note: string
  product_name?: string
  product_account_type?: string
  product_rate?: number | null
  product_description?: string
  requires_deposit?: boolean
  id?: string
}

interface OriginatedAccount {
  id: string
  account_number: string
  balance: number
}

interface DuplicateAccount {
  account_number: string
  opened_at: string
}

interface RecommendationPanelProps {
  customerId: string
}

function maskAccountNumber(accountNumber: string): string {
  return `••••${accountNumber.slice(-4)}`
}

export function RecommendationPanel({ customerId }: RecommendationPanelProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [sessionComplianceNote, setSessionComplianceNote] = useState<string | null>(null)
  const [notEligible, setNotEligible] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [complianceExpanded, setComplianceExpanded] = useState(false)
  const [depositAmounts, setDepositAmounts] = useState<Record<string, number>>({})
  const [originatedAccounts, setOriginatedAccounts] = useState<Record<string, OriginatedAccount>>({})

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogRec, setDialogRec] = useState<Recommendation | null>(null)
  const [dialogLoading, setDialogLoading] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [dialogDuplicate, setDialogDuplicate] = useState<DuplicateAccount | null>(null)

  async function handleGetRecommendation() {
    setLoading(true)
    setError(null)
    setNotEligible(false)
    setRecommendations([])
    setSessionComplianceNote(null)
    setDismissedIds(new Set())
    setDepositAmounts({})
    setOriginatedAccounts({})

    try {
      const res = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Failed to generate recommendations")
        return
      }

      if (data.eligible === false) {
        setNotEligible(true)
        return
      }

      const productsRes = await fetch("/api/products")
      const products = await productsRes.json()
      const productMap = new Map(
        products.map((p: { id: string; name: string; account_type: string; rate: number | null; description: string; requires_deposit: boolean }) => [p.id, p])
      )

      const enriched = data.recommendations.map((rec: Recommendation) => {
        const product = productMap.get(rec.product_id) as { name?: string; account_type?: string; rate?: number | null; description?: string; requires_deposit?: boolean } | undefined
        return {
          ...rec,
          product_name: product?.name || "Unknown Product",
          product_account_type: product?.account_type || "",
          product_rate: product?.rate,
          product_description: product?.description || "",
          requires_deposit: product?.requires_deposit ?? false,
        }
      })

      setRecommendations(enriched)
      setSessionComplianceNote(data.sessionComplianceNote || null)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  async function handleDismiss(recommendationId: string) {
    try {
      const res = await fetch(`/api/recommendations/${recommendationId}/dismiss`, {
        method: "PATCH",
      })
      if (res.ok) {
        setDismissedIds((prev) => new Set([...prev, recommendationId]))
      }
    } catch {
      // Silent failure
    }
  }

  function handleDepositChange(productId: string, amount: number) {
    setDepositAmounts((prev) => ({ ...prev, [productId]: amount }))
  }

  function openOriginateDialog(rec: Recommendation) {
    setDialogRec(rec)
    setDialogError(null)
    setDialogDuplicate(null)
    setDialogLoading(false)
    setDialogOpen(true)
  }

  async function handleConfirmOriginate() {
    if (!dialogRec) return

    setDialogLoading(true)
    setDialogError(null)

    const depositAmount = dialogRec.requires_deposit
      ? (depositAmounts[dialogRec.product_id] || 0)
      : 0

    try {
      const res = await fetch("/api/originate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendationId: dialogRec.id,
          customerId,
          productId: dialogRec.product_id,
          depositAmount,
        }),
      })

      const data = await res.json()

      if (res.status === 201 && data.account) {
        // Success — record the originated account and close dialog
        setOriginatedAccounts((prev) => ({
          ...prev,
          [dialogRec.product_id]: {
            id: data.account.id,
            account_number: data.account.account_number,
            balance: data.account.balance,
          },
        }))
        setDialogOpen(false)
        // Refresh the page data (Server Components re-render, history table re-fetches)
        router.refresh()
      } else if (data.duplicate) {
        // Duplicate — show hard-stop
        setDialogDuplicate({
          account_number: data.existingAccount?.account_number || "Unknown",
          opened_at: data.existingAccount?.opened_at || "",
        })
      } else if (res.status === 422) {
        setDialogError(data.error || "Validation error")
      } else {
        setDialogError(data.error || "An unexpected error occurred")
      }
    } catch {
      setDialogError("Network error. Please try again.")
    } finally {
      setDialogLoading(false)
    }
  }

  const visibleRecs = recommendations.filter((r) => !dismissedIds.has(r.id || r.product_id))

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI Product Recommendations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Idle state */}
          {!loading && recommendations.length === 0 && !notEligible && !error && (
            <Button onClick={handleGetRecommendation}>
              Get Recommendation
            </Button>
          )}

          {/* Loading */}
          {loading && (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-2 p-4 border rounded-lg">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="space-y-3">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
              <Button onClick={handleGetRecommendation} variant="outline" size="sm">
                Try Again
              </Button>
            </div>
          )}

          {/* No eligible */}
          {notEligible && (
            <div className="space-y-3">
              <Alert variant="info">
                <AlertDescription>No eligible products found for this customer.</AlertDescription>
              </Alert>
              <Button onClick={handleGetRecommendation} variant="outline" size="sm">
                Try Again
              </Button>
            </div>
          )}

          {/* Results */}
          {visibleRecs.length > 0 && (
            <div className="space-y-4">
              {visibleRecs.map((rec) => (
                <RecommendationCard
                  key={rec.product_id}
                  recommendation={rec}
                  depositAmount={depositAmounts[rec.product_id] || 0}
                  onDepositChange={(amount) => handleDepositChange(rec.product_id, amount)}
                  onDismiss={() => handleDismiss(rec.id || rec.product_id)}
                  onOriginate={() => openOriginateDialog(rec)}
                  originatedAccount={originatedAccounts[rec.product_id] || null}
                />
              ))}

              {/* Compliance note */}
              {sessionComplianceNote && (
                <div className="border rounded-lg p-3">
                  <button
                    onClick={() => setComplianceExpanded(!complianceExpanded)}
                    aria-expanded={complianceExpanded}
                    aria-controls="compliance-note-content"
                    className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${complianceExpanded ? "rotate-90" : ""}`} aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                    Compliance &amp; Fairness Note
                  </button>
                  {complianceExpanded && (
                    <p id="compliance-note-content" className="mt-2 text-sm text-muted-foreground pl-6">
                      {sessionComplianceNote}
                    </p>
                  )}
                </div>
              )}

              <Button onClick={handleGetRecommendation} variant="outline" size="sm">
                Generate New Recommendations
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Origination Confirm Dialog */}
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          {dialogDuplicate ? (
            // Duplicate hard-stop view
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Account Already Exists</AlertDialogTitle>
                <AlertDialogDescription>
                  This customer already holds an active {dialogRec?.product_name} (account {maskAccountNumber(dialogDuplicate.account_number)}
                  {dialogDuplicate.opened_at && `, opened ${new Date(dialogDuplicate.opened_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}).
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDialogOpen(false)}>Close</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          ) : (
            // Normal confirm view
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Open {dialogRec?.product_name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  {dialogRec?.requires_deposit && depositAmounts[dialogRec?.product_id || ""] > 0 ? (
                    <>Opening deposit: <strong>${depositAmounts[dialogRec?.product_id || ""]?.toLocaleString()}.00</strong></>
                  ) : dialogRec?.requires_deposit ? (
                    "A deposit amount is required for this product."
                  ) : (
                    "This product does not require an opening deposit."
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>

              {dialogError && (
                <Alert variant="destructive">
                  <AlertDescription>{dialogError}</AlertDescription>
                </Alert>
              )}

              <AlertDialogFooter>
                <AlertDialogCancel disabled={dialogLoading}>Cancel</AlertDialogCancel>
                <Button
                  onClick={handleConfirmOriginate}
                  disabled={dialogLoading}
                  size="default"
                >
                  {dialogLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Originating...
                    </span>
                  ) : (
                    "Confirm"
                  )}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ─── RecommendationCard ────────────────────────────────────────────────────────

interface RecommendationCardProps {
  recommendation: Recommendation
  depositAmount: number
  onDepositChange: (amount: number) => void
  onDismiss: () => void
  onOriginate: () => void
  originatedAccount: OriginatedAccount | null
}

function RecommendationCard({
  recommendation,
  depositAmount,
  onDepositChange,
  onDismiss,
  onOriginate,
  originatedAccount,
}: RecommendationCardProps) {
  const rec = recommendation
  const requiresDeposit = rec.requires_deposit ?? false
  const isOriginated = !!originatedAccount

  return (
    <div className={`border rounded-lg p-4 space-y-3 ${isOriginated ? "bg-success/5 border-success/30" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant="default" className="text-xs">
            #{rec.rank}
          </Badge>
          <h4 className="font-medium text-sm">{rec.product_name}</h4>
        </div>
        {rec.product_rate !== null && rec.product_rate !== undefined && (
          <span className="text-xs text-muted-foreground font-mono">
            {rec.product_rate.toFixed(2)}% {["SAVINGS", "CD", "MONEY_MARKET"].includes(rec.product_account_type || "") ? "APY" : "APR"}
          </span>
        )}
      </div>

      {rec.product_description && (
        <p className="text-xs text-muted-foreground">{rec.product_description}</p>
      )}

      <p className="text-sm">{rec.rationale}</p>

      {/* Originated success state */}
      {isOriginated && (
        <div className="flex items-center gap-2 p-2 bg-success/10 rounded text-sm">
          <Badge variant="success" className="text-[10px]">ORIGINATED</Badge>
          <span className="font-mono text-xs">Account {maskAccountNumber(originatedAccount.account_number)}</span>
        </div>
      )}

      {/* Deposit input + action buttons — only when not yet originated */}
      {!isOriginated && (
        <>
          {requiresDeposit && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">
                Opening deposit:
              </label>
              <div className="relative">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={depositAmount || ""}
                  onChange={(e) => onDepositChange(Number(e.target.value))}
                  className="w-32 pl-5 h-8 text-sm"
                  placeholder="0"
                />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={requiresDeposit && depositAmount <= 0}
              onClick={onOriginate}
            >
              Originate
            </Button>
            <Button size="sm" variant="outline" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
