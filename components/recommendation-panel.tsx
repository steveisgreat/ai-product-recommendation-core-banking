"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"

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
  id?: string // recommendation row ID for dismiss
}

interface RecommendationPanelProps {
  customerId: string
}

export function RecommendationPanel({ customerId }: RecommendationPanelProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [sessionComplianceNote, setSessionComplianceNote] = useState<string | null>(null)
  const [notEligible, setNotEligible] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [complianceExpanded, setComplianceExpanded] = useState(false)
  const [depositAmounts, setDepositAmounts] = useState<Record<string, number>>({})

  async function handleGetRecommendation() {
    setLoading(true)
    setError(null)
    setNotEligible(false)
    setRecommendations([])
    setSessionComplianceNote(null)
    setDismissedIds(new Set())
    setDepositAmounts({})

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

      // Fetch product details to enrich recommendations
      const productsRes = await fetch("/api/products")
      const products = await productsRes.json()
      const productMap = new Map(
        products.map((p: { id: string; name: string; account_type: string; rate: number | null; description: string; requires_deposit: boolean }) => [p.id, p])
      )

      const enriched = data.recommendations.map((rec: Recommendation) => {
        const product = productMap.get(rec.product_id) as { name?: string; account_type?: string; rate?: number | null; description?: string; requires_deposit?: boolean } | undefined
        return {
          ...rec,
          // rec.id is now the real recommendation row UUID from the API (not product_id)
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
      // Silent failure for dismiss — card stays visible
    }
  }

  function handleDepositChange(productId: string, amount: number) {
    setDepositAmounts((prev) => ({ ...prev, [productId]: amount }))
  }

  const visibleRecs = recommendations.filter((r) => !dismissedIds.has(r.id || r.product_id))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI Product Recommendations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Idle state — show button */}
        {!loading && recommendations.length === 0 && !notEligible && !error && (
          <Button onClick={handleGetRecommendation}>
            Get Recommendation
          </Button>
        )}

        {/* Loading state */}
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

        {/* Error state */}
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

        {/* No eligible products */}
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
                customerId={customerId}
                depositAmount={depositAmounts[rec.product_id] || 0}
                onDepositChange={(amount) => handleDepositChange(rec.product_id, amount)}
                onDismiss={() => handleDismiss(rec.id || rec.product_id)}
              />
            ))}

            {/* Compliance note drawer */}
            {sessionComplianceNote && (
              <div className="border rounded-lg p-3">
                <button
                  onClick={() => setComplianceExpanded(!complianceExpanded)}
                  aria-expanded={complianceExpanded}
                  aria-controls="compliance-note-content"
                  className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`transition-transform ${complianceExpanded ? "rotate-90" : ""}`}
                  >
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                  Compliance &amp; Fairness Note
                </button>
                {complianceExpanded && (
                  <p id="compliance-note-content" className="mt-2 text-sm text-muted-foreground pl-6">
                    {sessionComplianceNote}
                  </p>
                )}
              </div>
            )}

            {/* Re-generate button */}
            <Button onClick={handleGetRecommendation} variant="outline" size="sm">
              Generate New Recommendations
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── RecommendationCard ────────────────────────────────────────────────────────

interface RecommendationCardProps {
  recommendation: Recommendation
  customerId: string
  depositAmount: number
  onDepositChange: (amount: number) => void
  onDismiss: () => void
}

function RecommendationCard({
  recommendation,
  customerId,
  depositAmount,
  onDepositChange,
  onDismiss,
}: RecommendationCardProps) {
  const rec = recommendation
  const requiresDeposit = rec.requires_deposit ?? false

  return (
    <div className="border rounded-lg p-4 space-y-3">
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

      {/* Deposit amount input — only for deposit products */}
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

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={requiresDeposit && depositAmount <= 0}
          data-product-id={rec.product_id}
          data-customer-id={customerId}
          data-requires-deposit={requiresDeposit}
          data-deposit-amount={depositAmount}
        >
          Originate
        </Button>
        <Button size="sm" variant="outline" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}
