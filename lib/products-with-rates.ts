/**
 * lib/products-with-rates.ts
 * 
 * Shared helper that fetches products from DB and overlays live FRED-derived rates.
 * Both recommendation-engine and /api/products call this — neither applies rates independently.
 */
import { sql } from '@/lib/db/index'
import { getFredRates } from '@/lib/fred-service'
import type { Product } from '@/lib/db/types'

export async function getProductsWithRates(): Promise<Product[]> {
  // Fetch all products from DB
  const rows = await sql`SELECT * FROM products`

  // Get live FRED-derived rates
  let rateMap: Record<string, number>
  try {
    rateMap = await getFredRates()
  } catch {
    // If FRED fails entirely, fall through to DB rates
    rateMap = {}
  }

  // Merge rates: FRED rate overrides DB rate when available
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    account_type: row.account_type,
    requires_deposit: row.requires_deposit,
    rate: rateMap[row.account_type] ?? row.rate ?? null,
    eligibility_rules: typeof row.eligibility_rules === 'string' 
      ? JSON.parse(row.eligibility_rules) 
      : row.eligibility_rules,
    description: row.description,
  }))
}
