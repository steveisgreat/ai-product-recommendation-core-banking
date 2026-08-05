"use client"

import { Fragment, useEffect, useState } from "react"
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

interface RecommendationRow {
  id: string
  product_id: string
  product_name: string
  product_account_type: string
  rank: number
  rationale: string
  compliance_note: string
  status: string
  originated_account_id: string | null
  dismissed_until: string | null
}

interface Session {
  session_id: string
  created_at: string
  sessionComplianceNote: string
  recommendations: RecommendationRow[]
}

interface AuditRecord {
  id: string
  product_id: string
  product_name: string
  rules_evaluated: Array<{
    rule_key: string
    description: string
    passed: boolean
    actual_value: string | number | boolean
  }>
  overall_eligible: boolean
}

interface RecommendationHistoryTableProps {
  customerId: string
}

function getStatusBadgeVariant(status: string): "secondary" | "success" | "warning" {
  switch (status) {
    case "ORIGINATED": return "success"
    case "DISMISSED": return "warning"
    default: return "secondary" // PENDING
  }
}

export function RecommendationHistoryTable({ customerId }: RecommendationHistoryTableProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const [auditData, setAuditData] = useState<Record<string, AuditRecord[]>>({})
  const [auditLoading, setAuditLoading] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/recommendations/${customerId}`)
      .then((res) => res.json())
      .then((data) => {
        setSessions(data || [])
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [customerId])

  async function toggleAudit(sessionId: string) {
    if (expandedSession === sessionId) {
      setExpandedSession(null)
      return
    }

    setExpandedSession(sessionId)

    // If we already have audit data for this session, don't re-fetch
    if (auditData[sessionId]) return

    setAuditLoading(sessionId)
    try {
      const res = await fetch(`/api/eligibility-audit/${sessionId}`)
      if (res.ok) {
        const data = await res.json()
        setAuditData((prev) => ({ ...prev, [sessionId]: data }))
      }
    } catch {
      // Silent failure — just don't show audit data
    } finally {
      setAuditLoading(null)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recommendation History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (sessions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recommendation History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No recommendation history yet.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recommendation History</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Products Suggested</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => (
              <Fragment key={session.session_id}>
                <TableRow
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => toggleAudit(session.session_id)}
                  tabIndex={0}
                  aria-expanded={expandedSession === session.session_id}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      toggleAudit(session.session_id)
                    }
                  }}
                >
                  <TableCell>
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
                      aria-hidden="true"
                      className={`transition-transform ${expandedSession === session.session_id ? "rotate-90" : ""}`}
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </TableCell>
                  <TableCell className="text-sm">
                    {new Date(session.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </TableCell>
                  <TableCell className="text-sm">
                    {session.recommendations.map((r) => r.product_name).join(", ")}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {session.recommendations.map((r) => (
                        <Badge key={r.product_id} variant={getStatusBadgeVariant(r.status)} className="text-[10px]">
                          {r.status}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>

                {/* Expanded audit detail */}
                {expandedSession === session.session_id && (
                  <TableRow>
                    <TableCell colSpan={4} className="bg-muted/30 p-4">
                      {/* Compliance note */}
                      {session.sessionComplianceNote && (
                        <div className="mb-4">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Compliance Note</p>
                          <p className="text-sm">{session.sessionComplianceNote}</p>
                        </div>
                      )}

                      {/* Audit records */}
                      {auditLoading === session.session_id ? (
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-3/4" />
                        </div>
                      ) : auditData[session.session_id] ? (
                        <EligibilityAuditDetail records={auditData[session.session_id]} />
                      ) : (
                        <p className="text-xs text-muted-foreground">No audit data available.</p>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ─── EligibilityAuditDetail ────────────────────────────────────────────────────

interface EligibilityAuditDetailProps {
  records: AuditRecord[]
}

function EligibilityAuditDetail({ records }: EligibilityAuditDetailProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">Eligibility Audit</p>
      {records.map((record) => (
        <div key={record.id} className="border rounded p-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium">{record.product_name}</span>
            <Badge variant={record.overall_eligible ? "success" : "secondary"} className="text-[10px]">
              {record.overall_eligible ? "ELIGIBLE" : "NOT ELIGIBLE"}
            </Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs h-7">Rule</TableHead>
                <TableHead className="text-xs h-7">Result</TableHead>
                <TableHead className="text-xs h-7">Actual Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {record.rules_evaluated.map((rule, i) => (
                <TableRow key={`${record.id}-${i}`}>
                  <TableCell className="text-xs py-1">{rule.description}</TableCell>
                  <TableCell className="py-1">
                    <Badge variant={rule.passed ? "success" : "destructive"} className="text-[10px]">
                      {rule.passed ? "PASS" : "FAIL"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs py-1 font-mono">
                    {String(rule.actual_value)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  )
}
