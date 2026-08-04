/**
 * lib/fred-service.ts
 *
 * Fetches the latest Federal Funds Rate from the FRED API and computes
 * product rate spreads. Uses Next.js fetch caching (24h revalidation).
 * Falls back to hardcoded rates if FRED is unavailable.
 */

// Hardcoded fallback rates (based on fed_rate ≈ 4.33%, prime ≈ 7.33%)
const FALLBACK_RATES: Record<string, number> = {
  CHECKING: 0.00,
  SAVINGS: 4.83,       // 4.33 + 0.50
  MONEY_MARKET: 4.58,  // 4.33 + 0.25
  CD: 5.33,            // 4.33 + 1.00
  CREDIT_CARD: 20.32,  // 7.33 + 12.99
  HELOC: 8.83,         // 7.33 + 1.50
  OVERDRAFT: 15.33,    // 7.33 + 8.00
}

function computeRates(fedRate: number): Record<string, number> {
  const primeRate = fedRate + 3.00
  return {
    CHECKING: 0.00,
    SAVINGS: +(fedRate + 0.50).toFixed(2),
    MONEY_MARKET: +(fedRate + 0.25).toFixed(2),
    CD: +(fedRate + 1.00).toFixed(2),
    CREDIT_CARD: +(primeRate + 12.99).toFixed(2),
    HELOC: +(primeRate + 1.50).toFixed(2),
    OVERDRAFT: +(primeRate + 8.00).toFixed(2),
  }
}

export async function getFredRates(): Promise<Record<string, number>> {
  const apiKey = process.env.FRED_API_KEY

  if (!apiKey) {
    console.warn('FRED_API_KEY not set, using fallback rates')
    return FALLBACK_RATES
  }

  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&sort_order=desc&limit=1&api_key=${apiKey}&file_type=json`

    const response = await fetch(url, {
      next: { revalidate: 86400 }, // 24-hour cache
    })

    if (!response.ok) {
      console.warn(`FRED API returned ${response.status}, using fallback rates`)
      return FALLBACK_RATES
    }

    const data = await response.json()
    const observations = data?.observations

    if (!observations || observations.length === 0 || observations[0].value === '.') {
      console.warn('FRED API returned no valid observations, using fallback rates')
      return FALLBACK_RATES
    }

    const fedRate = parseFloat(observations[0].value)
    if (isNaN(fedRate)) {
      console.warn('FRED API returned non-numeric rate, using fallback rates')
      return FALLBACK_RATES
    }

    return computeRates(fedRate)
  } catch (error) {
    console.warn('FRED API fetch failed, using fallback rates:', error)
    return FALLBACK_RATES
  }
}

// Exported for testing
export { FALLBACK_RATES, computeRates }
