import { NextResponse } from 'next/server'
import { getProductsWithRates } from '@/lib/products-with-rates'

export async function GET() {
  const products = await getProductsWithRates()
  return NextResponse.json(products)
}
