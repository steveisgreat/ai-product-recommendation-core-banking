# Nymbus AI Product Recommendations

An AI-driven product recommendation and account origination tool for a core banking system. A retail banker selects a customer, receives 1–3 AI-generated product recommendations ranked by relevance (with plain-English rationale and compliance/fairness notes), and can originate the recommended account in one click — closing the loop from insight to action inside the same application.

**Live demo:** [ai-product-recommendation-core-bank.vercel.app](https://ai-product-recommendation-core-bank.vercel.app)

## Project Context

This was built as a job application exercise using [Kiro's](https://kiro.dev) spec-driven development workflow. The full requirements, technical design, and implementation task list that drove this build are browsable at:

📁 [`.kiro/specs/ai-product-recommendations/`](.kiro/specs/ai-product-recommendations/)
- [`requirements.md`](.kiro/specs/ai-product-recommendations/requirements.md) — 8 formal requirements with acceptance criteria
- [`design.md`](.kiro/specs/ai-product-recommendations/design.md) — full technical architecture, DB schema, API routes, service layer
- [`tasks.md`](.kiro/specs/ai-product-recommendations/tasks.md) — 18-task implementation plan with dependency graph

**UI conventions:** shadcn/ui components were installed via the public `shadcn` CLI (v4), chosen to match the component patterns in Nymbus's internal `olb_react_graphql` reference repo. All components live under `components/ui/` and use the standard CVA + Tailwind pattern.

### APIs Integrated

| API | Purpose | Integration |
|-----|---------|-------------|
| **FRED** (`api.stlouisfed.org`) | Live Federal Funds Rate for product catalog rates | Fetched server-side with 24h cache; spread formulas derive each product's APY/APR from the benchmark rate |
| **Anthropic Claude** (`claude-haiku-4-5-20251001`) | Recommendation ranking and plain-English rationale generation | Structured JSON prompt → Zod-validated response → post-parse product membership enforcement |

### Sample Anthropic API Call

```typescript
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic() // reads ANTHROPIC_API_KEY from env

const response = await client.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 1024,
  system: 'You are a banking product recommendation assistant. Output strict JSON only.',
  messages: [{
    role: 'user',
    content: JSON.stringify({
      customer_signals: { total_balance_band: '5K_25K', tenure_months: 18 },
      eligible_products: [{ id: 'abc', name: 'High-Yield Savings', rate: 5.83 }],
    }),
  }],
})

const text = response.content.find(b => b.type === 'text')?.text
const recommendations = JSON.parse(text)
```

> The real implementation in [`lib/llm-service.ts`](lib/llm-service.ts) adds a 10-second abort timeout, markdown code-fence stripping, Zod schema validation, and a post-parse product-membership check that rejects any product_id not in the eligible set.

### What's mocked vs. real

| Layer | Status | Notes |
|-------|--------|-------|
| External account aggregation | **Mocked** | Fixture data via `lib/aggregator/mock-provider.ts` — swappable to real Plaid via `AggregatorProvider` interface |
| KYC/sanctions screening | **Mocked** | Customers assumed pre-verified (out of scope for this build) |
| Product rates | **Real** | Live FRED Federal Funds Rate from `api.stlouisfed.org`, 24h cached, with spread formulas per product type |
| AI recommendations | **Real** | Live Claude API calls with Zod-validated output + product membership enforcement |
| Account origination | **Real** | Atomic Postgres transactions with rollback on failure, server-side eligibility re-validation |
| Database | **Real** | Neon Postgres with full FK constraints, idempotent migrations, and seed data |

## Product Decisions and Reasoning

**Banded (not exact) balance/income data for the AI payload.** The `CustomerSignals` struct sent to Claude uses ordinal bands (`5K_25K`, `MIDDLE`) rather than exact dollar amounts or income figures. This is a deliberate privacy and fair-lending safeguard: exact values aren't needed for product relevance ranking, and banding reduces the surface area for potential proxy-discrimination claims while still giving the LLM enough signal to rank meaningfully.

**Banker-facing, not customer-facing.** This is a relationship-manager tool, not a customer self-service flow. The design assumes a banker reviews and contextualizes recommendations before discussing them with the customer — the rationale text is written to be "read aloud" quality, not marketing copy. This keeps the compliance posture simpler (banker makes the final decision, AI assists) and avoids the much harder UX/regulatory problem of AI-generated customer-facing financial advice.

**Deterministic eligibility engine + LLM only for ranking/rationale.** The AI never makes an eligibility decision. A rules-based `evaluateEligibility()` function determines which products a customer qualifies for using auditable, deterministic logic. Only the already-eligible set is sent to Claude, which ranks them and generates rationale. If Claude returns a product_id not in the eligible set, `validateProductMembership()` throws immediately and nothing is persisted. This is enforced programmatically, not just via prompt instruction — it's the hard compliance boundary that ensures the LLM can't override business rules.

How the two-stage selection works:

- **Eligibility** (`evaluateEligibility()` in `lib/eligibility-engine.ts`): each product carries a list of `rule_key`s — e.g. no existing account of that type, minimum tenure in months, minimum balance/income band (evaluated as ordinal ≥, not exact match), no overdraft in the last 90 days. A product passes only if the customer's anonymized signals satisfy every rule attached to it. This produces a machine-readable audit trail (`AuditRecord[]`) and the eligible product set.
- **Ranking** (Claude): only the eligible set is sent to the LLM, which ranks up to 3 products by relevance to the customer's signals and writes the plain-English rationale. The LLM has no ability to add ineligible products or override eligibility — `validateProductMembership()` enforces this boundary after every response.

**shadcn/ui via public CLI, not cloned reference components.** The public `shadcn` CLI (v4) was used rather than directly cloning Nymbus's private `olb_react_graphql` reference repo. This keeps the project self-contained and reproducible from a public checkout, while still matching the component API patterns (CVA variants, Tailwind utility classes, Radix primitives) that the reference repo uses.

## What I'd Change or Add With More Time

**No real funding source for deposit origination.** The `depositAmount` materializes into the new account's balance via a single `ACCOUNT_OPEN` transaction — there's no draw-down from an existing account. What the design calls "double-entry ledger integrity" is really just atomicity (both the account and transaction are created or neither is), not true double-entry bookkeeping with a balancing debit. A production system would model the funding source (internal transfer, wire, ACH) as a separate debit-side entry.

**Client-side customer search doesn't scale.** Task 12's customer list loads all rows and filters in-browser — fine for 5 seed customers, but a real system would need server-side search with typeahead/debounce against an indexed `full_name` column. The architecture supports this (the API route already accepts `?search=`), but the UI currently doesn't use it.

**`household_income_band` on the core customers table is unrealistic.** In a real core banking system, income data comes from a specific application/underwriting flow or a third-party income-verification integration at the point of a credit decision — not a persistent field on the core customer profile used for general cross-sell. This was a deliberate simplification to keep the demo self-contained without needing a separate application/underwriting domain model. It's not worth restructuring given how much of the schema and eligibility logic depends on it.

**Inline originated state instead of toast notification.** Task 16 originally called for a toast notification on successful origination, but no toast library was installed. The team deliberately chose persistent inline card state (green "ORIGINATED" badge + masked account number) instead, judging it better UX for a banker workflow than a transient toast that disappears after a few seconds. The originated state remains visible as long as the recommendation cards are on screen — a banker can always see what was already acted on without needing to remember a notification they might have missed.

## Prerequisites

- **Node 18+** and **pnpm** installed locally
- **Postgres database:** This project requires a Postgres database. Create a free instance at [neon.tech](https://neon.tech) or [supabase.com](https://supabase.com), then copy the connection string they provide — you'll need it for `DATABASE_URL` in the next step.
- **Anthropic API key:** Obtain from [platform.anthropic.com](https://platform.anthropic.com) (not console.anthropic.com)
- **FRED API key (free):** Register at [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html)

## Setup

Run these commands in order:

```bash
pnpm install
pnpm approve-builds        # if prompted for build script approval
cp .env.local.example .env.local   # then fill in real values for all 4 vars
pnpm migrate               # creates all tables in your Postgres database
pnpm seed                  # loads demo customers, products, and transactions
pnpm dev                   # starts the dev server at http://localhost:3000
```

> **Note:** `pnpm migrate` and `pnpm seed` must both be run before the app will function — the app has no bundled SQLite fallback.

## Running Tests

```bash
pnpm test             # runs full test suite (unit + property-based + E2E)
pnpm test:coverage    # test run with coverage report
```

The test suite includes 72 tests across 8 files:
- **Eligibility engine** (16): deterministic evaluation, ordinal band comparisons, unknown-rule-key rejection, 7 property-based tests
- **LLM service** (11): Zod schema validation, product membership enforcement, code-fence stripping, out-of-range rank rejection
- **Origination service** (11): deposit validation, duplicate detection, atomic transactions, 5 property-based tests (including generative balance/transaction invariants)
- **Recommendation engine** (2): dismissal cooldown properties (active excludes, expired doesn't)
- **DB signal assembly** (5): CustomerSignals derivation, PII exclusion verification, overdraft flag detection
- **FRED service** (8): rate computation, fallback handling, spread formulas
- **Aggregator** (10): fixture data correctness, provider selection
- **E2E smoke test** (9): full happy path — customers → aggregator → recommendations → dismiss → originate → history → audit → duplicate rejection

## Environment Variables

| Variable | Required | Purpose | Where to get it |
|----------|----------|---------|-----------------|
| `DATABASE_URL` | Yes | Postgres connection string | Your [Neon](https://neon.tech) or [Supabase](https://supabase.com) project dashboard |
| `ANTHROPIC_API_KEY` | Yes | Claude API authentication | [platform.anthropic.com](https://platform.anthropic.com) (not console.anthropic.com) |
| `FRED_API_KEY` | Yes | FRED API for live benchmark rates | [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html) |
| `AGGREGATOR_PROVIDER` | No | `mock` (default) or `plaid` | Set to `mock` for local development |

## Resetting Your Local Data

Re-run `pnpm seed` any time you want to reset to a clean demo state.

> **Note:** `pnpm seed` performs a full wipe of all 7 tables before reinserting fixture data. Any accounts originated or recommendations dismissed through manual testing in the running app will be erased. This is expected behavior — the seed script is designed to return the database to a known starting point for demos and development.

## Swapping the Mock Aggregator for Real Plaid

The external account aggregator is behind an `AggregatorProvider` interface in `lib/aggregator/interface.ts`:

1. Implement `lib/aggregator/plaid-provider.ts` satisfying the `AggregatorProvider` interface
2. Set `AGGREGATOR_PROVIDER=plaid` in your environment
3. No other code changes are required — the API route and signal assembly query both go through the interface

## Architecture

```
┌────────────────────────────────────────────────────────┐
│                  Next.js App (Vercel)                   │
│                                                         │
│  ┌──────────────┐    ┌────────────────────────────────┐ │
│  │  App Router  │    │        API Routes              │ │
│  │    Pages     │◄──►│   /api/*  (Route Handlers)     │ │
│  └──────────────┘    └───────────────┬────────────────┘ │
│                                      │                  │
│                      ┌───────────────▼──────────────┐   │
│                      │    Server Services (lib/)     │   │
│                      │  eligibility-engine           │   │
│                      │  recommendation-engine        │   │
│                      │  llm-service                  │   │
│                      │  origination-service          │   │
│                      │  fred-service                 │   │
│                      │  aggregator/                  │   │
│                      └───────────────┬──────────────┘   │
└──────────────────────────────────────┼──────────────────┘
                                       │
               ┌───────────────────────┼─────────────────┐
               │                       │                 │
      ┌────────▼──────┐    ┌───────────▼──────┐  ┌───────▼──────┐
      │   Postgres    │    │   Claude API     │  │   FRED API   │
      │  (Neon)       │    │  (Anthropic)     │  │  (rates)     │
      └───────────────┘    └──────────────────┘  └──────────────┘
```

## License

This project was built as a demonstration exercise and is not licensed for production use.
