import type { AggregatorProvider } from './interface'
import { MockAggregatorProvider } from './mock-provider'

export function getProvider(): AggregatorProvider {
  const provider = process.env.AGGREGATOR_PROVIDER || 'mock'

  switch (provider) {
    case 'mock':
      return new MockAggregatorProvider()
    // Future: case 'plaid': return new PlaidProvider()
    default:
      console.warn(`Unknown AGGREGATOR_PROVIDER "${provider}", falling back to mock`)
      return new MockAggregatorProvider()
  }
}

// Re-export types for convenience
export type { AggregatorProvider, ExternalAccount } from './interface'
