import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface CustomerProfileCardProps {
  fullName: string
  householdSize: number
  incomeBand: string
  tenureMonths: number
  memberSince: string
}

function formatIncomeBand(band: string): string {
  return band
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

export function CustomerProfileCard({
  fullName,
  householdSize,
  incomeBand,
  tenureMonths,
  memberSince,
}: CustomerProfileCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{fullName}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Household Size</p>
            <p className="text-sm font-medium">{householdSize}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Income Band</p>
            <Badge variant="secondary" className="mt-0.5">{formatIncomeBand(incomeBand)}</Badge>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Tenure</p>
            <p className="text-sm font-medium">{tenureMonths} months</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Member Since</p>
            <p className="text-sm font-medium">
              {new Date(memberSince).toLocaleDateString("en-US", { year: "numeric", month: "short" })}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
