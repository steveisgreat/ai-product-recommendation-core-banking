import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getFredRates, FALLBACK_RATES, computeRates } from '@/lib/fred-service'

describe('FRED Rate Service', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    // Ensure FRED_API_KEY is set for tests
    process.env.FRED_API_KEY = 'test-key'
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('returns computed rates when FRED API responds successfully', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        observations: [{ date: '2024-01-01', value: '5.33' }],
      }),
    }) as unknown as typeof fetch

    const rates = await getFredRates()

    expect(rates.CHECKING).toBe(0.00)
    expect(rates.SAVINGS).toBe(5.83)       // 5.33 + 0.50
    expect(rates.MONEY_MARKET).toBe(5.58)  // 5.33 + 0.25
    expect(rates.CD).toBe(6.33)            // 5.33 + 1.00
    expect(rates.CREDIT_CARD).toBe(21.32)  // 8.33 + 12.99
    expect(rates.HELOC).toBe(9.83)         // 8.33 + 1.50
    expect(rates.OVERDRAFT).toBe(16.33)    // 8.33 + 8.00
  })

  it('returns fallback rates when FRED API returns non-200', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as unknown as typeof fetch

    const rates = await getFredRates()
    expect(rates).toEqual(FALLBACK_RATES)
  })

  it('returns fallback rates when fetch throws (network error)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch

    const rates = await getFredRates()
    expect(rates).toEqual(FALLBACK_RATES)
  })

  it('returns fallback rates when FRED API returns empty observations', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ observations: [] }),
    }) as unknown as typeof fetch

    const rates = await getFredRates()
    expect(rates).toEqual(FALLBACK_RATES)
  })

  it('returns fallback rates when observation value is "." (FRED missing data marker)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        observations: [{ date: '2024-01-01', value: '.' }],
      }),
    }) as unknown as typeof fetch

    const rates = await getFredRates()
    expect(rates).toEqual(FALLBACK_RATES)
  })

  it('returns fallback rates when FRED_API_KEY is not set', async () => {
    delete process.env.FRED_API_KEY

    const rates = await getFredRates()
    expect(rates).toEqual(FALLBACK_RATES)
  })

  describe('computeRates', () => {
    it('correctly applies spread formulas for a given fed rate', () => {
      const rates = computeRates(5.00)
      expect(rates.CHECKING).toBe(0.00)
      expect(rates.SAVINGS).toBe(5.50)       // 5.00 + 0.50
      expect(rates.MONEY_MARKET).toBe(5.25)  // 5.00 + 0.25
      expect(rates.CD).toBe(6.00)            // 5.00 + 1.00
      expect(rates.CREDIT_CARD).toBe(20.99)  // 8.00 + 12.99
      expect(rates.HELOC).toBe(9.50)         // 8.00 + 1.50
      expect(rates.OVERDRAFT).toBe(16.00)    // 8.00 + 8.00
    })

    it('returns all 7 product types', () => {
      const rates = computeRates(4.50)
      expect(Object.keys(rates)).toHaveLength(7)
      expect(Object.keys(rates).sort()).toEqual(
        ['CD', 'CHECKING', 'CREDIT_CARD', 'HELOC', 'MONEY_MARKET', 'OVERDRAFT', 'SAVINGS'].sort()
      )
    })
  })
})
