# Design Document

## Overview

AI-driven product recommendation and account origination tool for a core banking system. A retail banker selects a customer, the system runs a deterministic eligibility pass against a product catalog, then calls the Anthropic Claude API to rank and rationalize the eligible products. The banker can originate an account in one click, creating both the account record and the opening ledger entry atomically in Postgres.

**Stack:** Next.js 14 App Router + TypeScript, shadcn/ui (`@/components/ui/*`), pnpm, Postgres (Supabase or Neon), Anthropic Claude API, Vercel deployment.

---

## Architecture Overview

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
      │ (Supabase /   │    │  (Anthropic)     │  │  (rates)     │
      │    Neon)      │    └──────────────────┘  └──────────────┘
      └───────────────┘
```

---

## Database Schema

All tables use UUID primary keys. Migrations are SQL files run at deploy time.

```sql
-- customers
CREATE TABLE customers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name             TEXT NOT NULL,
  household_size        INTEGER NOT NULL CHECK (household_size >= 1),
  household_income_band TEXT NOT NULL CHECK (household_income_band IN (
                          'LOW','LOWER_MIDDLE','MIDDLE','UPPER_MIDDLE','HIGH')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
  -- NOTE: no age/DOB column. If banker-display age is ever needed,
  -- it goes in a separate table never joined into the AI payload query.
);

-- products
CREATE TABLE products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  account_type      TEXT NOT NULL,
  requires_deposit  BOOLEAN NOT NULL DEFAULT false,
                    -- true for CHECKING, SAVINGS, CD, MONEY_MARKET
                    -- false for CREDIT_CARD, HELOC, OVERDRAFT
  rate              NUMERIC(6,4),           -- derived from FRED at seed/refresh time
  eligibility_rules JSONB NOT NULL,         -- array of rule objects (see Eligibility Engine)
  description       TEXT NOT NULL
);

-- accounts (originated records)
CREATE TABLE accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_id     UUID NOT NULL REFERENCES products(id)  ON DELETE RESTRICT,
  account_type   TEXT NOT NULL,
  balance        NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  opened_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
  account_number CHAR(10) NOT NULL,
  CONSTRAINT uq_account_number UNIQUE (account_number),
  -- Idempotent origination guard: only one ACTIVE account per customer+product
  CONSTRAINT uq_active_customer_product UNIQUE (customer_id, product_id, status)
);

-- transactions (ledger entries)
CREATE TABLE transactions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount      NUMERIC(15,2) NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('DEBIT','CREDIT','ACCOUNT_OPEN')),
  description TEXT NOT NULL,
  posted_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- external_accounts (upserted by mock aggregator on each profile load)
CREATE TABLE external_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  institution_name    TEXT NOT NULL,
  account_type        TEXT NOT NULL,
  masked_number       CHAR(4) NOT NULL,       -- last 4 digits only
  approx_balance_band TEXT NOT NULL CHECK (approx_balance_band IN (
                        'UNDER_1K','1K_5K','5K_25K','25K_100K','OVER_100K')),
  last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- recommendations (one row per product per session)
CREATE TABLE recommendations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID NOT NULL,         -- groups 1-3 rows from one request
  customer_id           UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_id            UUID NOT NULL REFERENCES products(id)  ON DELETE RESTRICT,
  rank                  INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
  rationale             TEXT NOT NULL,
  compliance_note       TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','ORIGINATED','DISMISSED')),
  originated_account_id UUID REFERENCES accounts(id),
  dismissed_until       TIMESTAMPTZ,           -- set to now() + 90 days on DISMISS; NULL otherwise
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_recommendations_customer ON recommendations(customer_id);
CREATE INDEX idx_recommendations_session  ON recommendations(session_id);

-- eligibility_audit (separate table — compliance officer access pattern)
CREATE TABLE eligibility_audit (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID NOT NULL,             -- matches recommendations.session_id
  customer_id      UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_id       UUID NOT NULL REFERENCES products(id)  ON DELETE RESTRICT,
  rules_evaluated  JSONB NOT NULL,            -- [{rule_key, description, passed, actual_value}]
  overall_eligible BOOLEAN NOT NULL,
  evaluated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_eligibility_audit_session ON eligibility_audit(session_id);
```

### Schema design notes

- `session_id` (UUID generated per recommendation request) groups the 1–3 `recommendations` rows and all `eligibility_audit` rows for one banker request. This makes it easy to display a full session in the history log and lets compliance officers pull a complete audit with one query on `session_id`.
- The `UNIQUE (customer_id, product_id, status)` constraint on `accounts` is the DB-level backstop for idempotent origination. The application layer checks first; this constraint catches any double-click race condition. There is no legitimate "originate a second account of the same product" flow — the eligibility rules already exclude products the customer holds.
- `customers` has no `age` or `dob` column. The AI payload assembly query selects only from the allow-listed `CustomerSignals` fields (see Eligibility Engine section).
- `recommendations.dismissed_until` is set to `now() + interval '90 days'` when a row is dismissed. The eligibility assembly step filters out any product with an active (non-expired) dismissal for that customer before building the eligible set passed to the LLM.
- `products.requires_deposit` drives the opening deposit validation: deposit products (CHECKING, SAVINGS, CD, MONEY_MARKET) require a positive `depositAmount` at origination; non-deposit products (CREDIT_CARD, HELOC, OVERDRAFT) must receive `depositAmount = 0`.

---

## Component Architecture

### Pages (App Router)

```
app/
  layout.tsx                  # Root layout, sidebar nav with customer search
  page.tsx                    # Redirects → /customers
  customers/
    page.tsx                  # CustomerListPage
    [id]/
      page.tsx                # CustomerProfilePage
```

### UI Component Tree

```
CustomerListPage
  └── CustomerSearchTable       # shadcn DataTable, searchable/filterable by name

CustomerProfilePage
  ├── CustomerProfileCard       # full_name, household_size, income_band, tenure
  ├── CoreAccountsPanel         # accounts[] from DB — type, balance, status, account_number
  ├── ExternalAccountsPanel     # external_accounts[] fetched from /api/mock-aggregator
  │     ├── Skeleton            # shown while fetching (non-blocking)
  │     ├── Alert (warning)     # shown if aggregator times out or errors
  │     └── ExternalAccountRow  # institution, type, balance_band, masked_number
  ├── RecommendationPanel
  │     ├── Button "Get Recommendation"   # triggers POST /api/recommendations
  │     ├── Skeleton × 3                  # shown while Claude is responding
  │     ├── Alert (error)                 # shown if LLM call fails
  │     ├── Alert (info)                  # shown if no eligible products found
  │     ├── RecommendationCard × 1–3
  │     │     ├── Badge (rank)
  │     │     ├── ProductInfo             # name, rate, description
  │     │     ├── Rationale text          # 1–2 sentence plain English
  │     │     ├── DepositAmountInput      # shown for requires_deposit products only
  │     │     ├── Button "Originate"      # opens OriginationConfirmDialog
  │     │     └── Button "Dismiss"        # dismisses this card only (per-recommendation)
  │     └── ComplianceNoteDrawer          # collapsible; signals used + protected-class statement
  └── RecommendationHistoryTable
        # Reverse-chronological. Each row = one session (grouped by session_id).
        # Expandable to show EligibilityAuditDetail
        └── EligibilityAuditDetail        # rules_evaluated JSONB as pass/fail table rows

OriginationConfirmDialog                  # shadcn AlertDialog, mounted at CustomerProfilePage level
  # Normal case:
  #   "Open [Product Name] for this customer?"
  #   Shows depositAmount for deposit products; $0 implicit for non-deposit products.
  #   "Confirm" button submits POST /api/originate.
  #
  # Duplicate/race-condition case (should be rare given eligibility rules exclude held products):
  #   "This customer already holds an active [Product Name]
  #    (account #XXXXXXXXXX, opened MM/DD/YYYY)."
  #   Only a "Close" button — no origination option. This is a hard stop, not a confirm flow.
```

All components use `@/components/ui/*` (Card, Table, Badge, Button, Dialog, Drawer, Skeleton, Alert, AlertDialog, Input).

### State management

No global state library. Server Components fetch data directly. Client Components (`"use client"`) manage:
- `RecommendationPanel`: local state for recommendation results, loading, and error
- `RecommendationCard`: local state for depositAmount input and dismissed status
- `ExternalAccountsPanel`: local state for external accounts, loading, and error
- `OriginationConfirmDialog`: open/close + which recommendation is being confirmed + depositAmount

---

## API Route Design

All routes under `app/api/`. All responses are `application/json`. Errors return `{ error: string, code: string }`.

### Customers

```
GET /api/customers
    Query: ?search=string (optional)
    Returns: CustomerSummary[]

GET /api/customers/[id]
    Returns: {
      customer: Customer,
      accounts: Account[],
      transactionSummary: { totalDebits, totalCredits, avgMonthlyInflow }
    }
    Note: does NOT include external_accounts — fetched separately by the client
    so the profile page renders immediately without waiting for the aggregator.
```

### Aggregator

```
GET /api/mock-aggregator/[customerId]
    Returns: { accounts: ExternalAccount[] }
    Always HTTP 200. Empty array for unknown customer IDs.
    Side effect: upserts results into external_accounts table for later signal assembly.
    Delegates to lib/aggregator/index.ts → active AggregatorProvider.
```

### Products

```
GET /api/products
    Returns: Product[]  with rates derived from cached FRED value
    Next.js fetch cache: revalidate: 86400 (24h)
```

### Recommendations

```
POST /api/recommendations
     Body: { customerId: string }
     Flow:
       1. Fetch customer + accounts + transactions from DB
       2. Query recommendations for active dismissals:
          SELECT DISTINCT product_id FROM recommendations
          WHERE customer_id = $1 AND dismissed_until > now()
          Exclude these product_ids from the eligible set before calling LLM.
       3. Assemble CustomerSignals (anonymized — see Eligibility Engine)
       4. lib/eligibility-engine.evaluateEligibility(signals, allProducts)
          (eligible set already excludes dismissed products from step 2)
       5. If eligible.length === 0 → return { eligible: false }
       6. lib/llm-service.getRecommendations(signals, eligibleProducts)
       7. Generate session_id (UUID)
       8. Persist recommendations rows (1–3) + eligibility_audit rows — same transaction
       9. Return { sessionId, recommendations[], sessionComplianceNote }

GET /api/recommendations/[customerId]
    Returns: RecommendationSession[]  grouped by session_id, reverse-chronological

PATCH /api/recommendations/[recommendationId]/dismiss
      Dismisses a single recommendation row (not the whole session).
      Sets status = DISMISSED and dismissed_until = now() + interval '90 days'.
      Returns 409 if the row status is already ORIGINATED.
      A banker can dismiss one card and originate another from the same session.
```

### Origination

```
POST /api/originate
     Body: {
       recommendationId: string,
       customerId: string,
       productId: string,
       depositAmount: number    -- required field; must be 0 for non-deposit products,
                                -- must be > 0 for deposit products
     }
     Validation:
       - Fetch product.requires_deposit
       - If requires_deposit = true and depositAmount <= 0 → 422
       - If requires_deposit = false and depositAmount !== 0 → 422
     Flow:
       1. Re-assemble CustomerSignals from DB
       2. Re-run lib/eligibility-engine — if product no longer eligible → 422
       3. Query for existing ACTIVE account (customer_id + product_id)
          → If found: return { duplicate: true, existingAccount: AccountSummary }
            Client shows hard-stop dialog ("already holds active [Product]") with no origination option
       4. Generate unique 10-digit account_number (retry up to 3× on collision)
       5. BEGIN TRANSACTION
            INSERT accounts (status = ACTIVE, balance = depositAmount)
            INSERT transactions (type = ACCOUNT_OPEN, amount = depositAmount)
            UPDATE recommendations SET status = ORIGINATED,
              originated_account_id = <new account id>
          COMMIT  (ROLLBACK on any error → 500 with structured error)
       6. Return { account: AccountRecord }
```

### Audit

```
GET /api/eligibility-audit/[sessionId]
    Returns: EligibilityAuditRecord[]  (one per product evaluated in the session)
```

---

## Server Service Layer (`lib/`)

### `lib/db/index.ts`
Exports a Postgres client using `@vercel/postgres` or the `postgres` npm package with `DATABASE_URL`. Exports typed query helpers and shared TypeScript types generated from the schema.

### `lib/eligibility-engine.ts`

Pure function — no DB calls, no side effects, fully unit-testable.

```typescript
// The anonymized signal struct — only financial data, no PII, no protected-class fields
export type CustomerSignals = {
  account_count: number
  account_types: string[]
  total_balance_band: BalanceBand          // UNDER_1K | 1K_5K | 5K_25K | 25K_100K | OVER_100K
  avg_monthly_inflow_band: BalanceBand
  transaction_pattern_flags: string[]      // e.g. 'RECURRING_DIRECT_DEPOSIT', 'OVERDRAFT_LAST_90D'
  tenure_months: number
  household_income_band: IncomeBand        // LOW | LOWER_MIDDLE | MIDDLE | UPPER_MIDDLE | HIGH
  external_account_types: string[]
  existing_product_ids: string[]
}

export type AuditRecord = {
  product_id: string
  rule_key: string
  description: string
  passed: boolean
  actual_value: string | number | boolean
}

export type EligibilityResult = {
  eligible: Product[]
  audit: AuditRecord[]
}

export function evaluateEligibility(
  signals: CustomerSignals,
  products: Product[]
): EligibilityResult
```

`CustomerSignals` is assembled by the API route handler from raw DB data. It is the **only** input to both the eligibility engine and the LLM payload builder. It structurally cannot contain `full_name`, DOB, or any protected-class attribute.

Eligibility rules are stored as JSONB in `products.eligibility_rules`:
```json
[
  { "rule_key": "no_existing_checking",    "description": "Customer does not already hold a Checking Account" },
  { "rule_key": "min_tenure_months_3",     "description": "Customer relationship is at least 3 months old" },
  { "rule_key": "min_balance_band_5K_25K", "description": "Customer total balance is at least $5,000" }
]
```

**Ordinal band comparisons:** Balance-band and income-band rules (e.g. `min_balance_band_5K_25K`) use ordinal "≥" comparisons, not exact string equality. The engine defines explicit band orderings:

```typescript
const BALANCE_BAND_ORDER: BalanceBand[] = ['UNDER_1K', '1K_5K', '5K_25K', '25K_100K', 'OVER_100K']
const INCOME_BAND_ORDER: IncomeBand[]   = ['LOW', 'LOWER_MIDDLE', 'MIDDLE', 'UPPER_MIDDLE', 'HIGH']
```

A rule like `MIN_BALANCE_BAND_5K_25K` passes when the customer's `total_balance_band` index in `BALANCE_BAND_ORDER` is **≥** the index of `'5K_25K'` (which is 2). So a customer in `25K_100K` (index 3) or `OVER_100K` (index 4) also passes — not just `5K_25K` exactly. Same logic applies to `MIN_INCOME_BAND_MIDDLE` and `MIN_INCOME_BAND_UPPER_MIDDLE` against `INCOME_BAND_ORDER`.

Seed product catalog (6 products minimum, rates FRED-derived):

| Product | Key Eligibility Rules |
|---|---|
| Checking Account | No existing checking; tenure ≥ 0 months |
| High-Yield Savings | No existing HYSA; balance_band ≥ 1K_5K |
| Certificate of Deposit | Balance_band ≥ 5K_25K; no existing CD |
| Money Market Account | Balance_band ≥ 25K_100K; no existing MMA |
| Credit Card | Tenure ≥ 6 months; no OVERDRAFT_LAST_90D flag; income_band ≥ MIDDLE |
| HELOC | Balance_band ≥ 25K_100K; has external account; income_band ≥ UPPER_MIDDLE |
| Overdraft Protection | Has existing checking; no existing overdraft product |

### `lib/recommendation-engine.ts`

Orchestrator called by `POST /api/recommendations`:
1. Queries active dismissals for the customer; removes those product_ids from the candidate set
2. Calls `evaluateEligibility(signals, candidateProducts)`
3. If `eligible.length === 0`, returns early with `{ eligible: false }`
4. Calls `llm-service.getRecommendations(signals, eligible)`
5. Generates `session_id`
6. Persists `recommendations` rows + `eligibility_audit` rows in a single DB transaction
7. Returns structured response

### `lib/llm-service.ts`

Wraps the Anthropic SDK (`@anthropic-ai/sdk`). Model: `claude-haiku-4-5-20251001`. `max_tokens: 1024`.

**System prompt (enforced constraints):**
> You are a banking product recommendation assistant. You will receive a JSON object with anonymized customer financial signals and a list of eligible products.
>
> Rules you must follow without exception:
> - Use ONLY the fields provided in the input JSON. Do not infer or reference any information not present.
> - Never reference or imply any protected-class characteristics (race, color, religion, national origin, sex, marital status, age, or receipt of public assistance) in rationale or compliance notes.
> - Rank products by relevance to the customer's financial signals only — not by bank profitability or promotional status.
> - Rationale must be 1–2 plain-English sentences a banker could read aloud to a customer.
> - Output strict JSON only — no text outside the JSON object.
> - You may only recommend products from the `eligible_products` list provided. Do not introduce or reference any product not in that list.

**User message payload:**
```json
{
  "customer_signals": {
    "account_count": 2,
    "account_types": ["CHECKING"],
    "total_balance_band": "5K_25K",
    "avg_monthly_inflow_band": "1K_5K",
    "transaction_pattern_flags": ["RECURRING_DIRECT_DEPOSIT"],
    "tenure_months": 18,
    "household_income_band": "MIDDLE",
    "external_account_types": [],
    "existing_product_ids": ["<uuid>"]
  },
  "eligible_products": [
    { "id": "<uuid>", "name": "High-Yield Savings", "account_type": "SAVINGS", "rate": 5.25, "description": "..." }
  ]
}
```

**Output schema (Zod) + post-parse membership check:**
```typescript
const RecommendationOutputSchema = z.object({
  recommendations: z.array(z.object({
    product_id: z.string().uuid(),
    rank: z.number().int().min(1).max(3),
    rationale: z.string().max(600),   // ~100 words
    compliance_note: z.string()
  })).min(1).max(3),
  session_compliance_note: z.string()
})

// After Zod parse succeeds, enforce membership in the eligible set.
// This is the hard enforcement that "the AI never makes an eligibility decision."
// The system prompt instruction alone is not sufficient.
function validateProductMembership(
  parsed: z.infer<typeof RecommendationOutputSchema>,
  eligibleProducts: Product[]
): void {
  const eligibleIds = new Set(eligibleProducts.map(p => p.id))
  for (const rec of parsed.recommendations) {
    if (!eligibleIds.has(rec.product_id)) {
      throw new LLMServiceError(
        `LLM returned product_id ${rec.product_id} which is not in the eligible set`,
        'INVALID_PRODUCT_ID'
      )
    }
  }
}
```

Both Zod parse failure and membership check failure throw `LLMServiceError`, caught by `recommendation-engine`, which returns an error to the client without persisting anything.

### `lib/origination-service.ts`

```typescript
export async function originateAccount(params: {
  customerId: string
  productId: string
  recommendationId: string
  depositAmount: number
}): Promise<OriginationResult>

type OriginationResult =
  | { success: true; account: AccountRecord }
  | { success: false; duplicate: true; existingAccount: AccountSummary }
  | { success: false; notEligible: true }
```

- Validates `depositAmount` against `product.requires_deposit` before any DB write
- Generates 10-digit account_number; retries up to 3× on collision
- Wraps account INSERT + transaction INSERT + recommendation UPDATE in a single Postgres transaction

### `lib/fred-service.ts`

Fetches latest FEDFUNDS from FRED API. Rate map (prime = fed_rate + 3.00%):

| Product type | Rate formula |
|---|---|
| CHECKING | 0.00% |
| SAVINGS (HYSA) | fed_rate + 0.50% |
| MONEY_MARKET | fed_rate + 0.25% |
| CD_12MO | fed_rate + 1.00% |
| CREDIT_CARD | prime_rate + 12.99% |
| HELOC | prime_rate + 1.50% |
| OVERDRAFT | prime_rate + 8.00% |

Cached via `{ next: { revalidate: 86400 } }`. Falls back to hardcoded rates if FRED is unavailable.

### `lib/aggregator/` — Mock Aggregator (Plaid swap point)

```
lib/aggregator/
  interface.ts     # AggregatorProvider interface + ExternalAccount type
  mock-provider.ts # MockAggregatorProvider — in-memory fixture data
  index.ts         # exports getProvider() keyed on AGGREGATOR_PROVIDER env var
```

**`interface.ts`:**
```typescript
export interface ExternalAccount {
  institution_name: string
  account_type: string
  masked_number: string
  approx_balance_band: BalanceBand
  last_synced_at: string   // ISO 8601
}

export interface AggregatorProvider {
  getAccounts(customerId: string): Promise<ExternalAccount[]>
}
```

Fixture customers: (1) no external accounts, (2) one checking at Chase, (3) savings at Ally + checking at BofA, (4) investment at Fidelity, (5) three accounts at Wells Fargo / Marcus / Schwab.

**Swap to Plaid:** implement `plaid-provider.ts`, set `AGGREGATOR_PROVIDER=plaid`. No other changes.

---

## Data Flow: Recommendation Request

```
Banker clicks "Get Recommendation"
        │
        ▼
POST /api/recommendations { customerId }
        │
        ├─ 1. Fetch customer + accounts + transactions (DB)
        ├─ 2. Query active dismissals (dismissed_until > now()) → exclude from candidate set
        ├─ 3. Assemble CustomerSignals (no PII, no protected-class fields)
        ├─ 4. evaluateEligibility(signals, candidateProducts)
        │       └─ Returns: eligible[], auditRecords[]
        ├─ 5. eligible.length === 0?
        │       └─ YES → return { eligible: false }  (no LLM call made)
        ├─ 6. llm-service.getRecommendations(signals, eligible)
        │       ├─ Assemble system prompt + user payload JSON
        │       ├─ POST to Claude API (10s timeout)
        │       ├─ Zod-parse response
        │       ├─ validateProductMembership — reject any product_id not in eligible set
        │       └─ Return validated RecommendationOutput
        ├─ 7. Generate session_id (UUID)
        ├─ 8. BEGIN TRANSACTION
        │       ├─ INSERT recommendations rows (1–3, same session_id)
        │       └─ INSERT eligibility_audit rows (one per product evaluated)
        │       COMMIT
        └─ 9. Return { sessionId, recommendations[], sessionComplianceNote }
```

## Data Flow: Account Origination

```
Banker enters depositAmount (if deposit product), clicks "Originate"
        │
        ▼  OriginationConfirmDialog displays product name + depositAmount
        │
        ▼  Banker clicks "Confirm"
        │
        ▼
POST /api/originate { recommendationId, customerId, productId, depositAmount }
        │
        ├─ 1. Fetch product.requires_deposit
        │       requires_deposit=true + depositAmount <= 0  → 422
        │       requires_deposit=false + depositAmount !== 0 → 422
        ├─ 2. Re-fetch signals from DB; re-run evaluateEligibility (server-side)
        │       └─ Product no longer eligible? → 422
        ├─ 3. SELECT accounts WHERE customer_id + product_id + status=ACTIVE
        │       └─ Found? → return { duplicate: true, existingAccount }
        │            Client shows hard-stop dialog: "already holds active [Product]"
        │            No origination option — Close only
        ├─ 4. Generate account_number (10-digit, retry up to 3× on collision)
        ├─ 5. BEGIN TRANSACTION
        │       ├─ INSERT accounts (status=ACTIVE, balance=depositAmount)
        │       ├─ INSERT transactions (type=ACCOUNT_OPEN, amount=depositAmount)
        │       └─ UPDATE recommendations SET status=ORIGINATED, originated_account_id=<id>
        │       COMMIT — or ROLLBACK on any error → 500 + structured error
        └─ 6. Return { account: AccountRecord }
```

---

## Key Invariants

| Invariant | Mechanism |
|---|---|
| Double-entry ledger integrity | Account INSERT + transaction INSERT in single Postgres transaction; ROLLBACK on any failure |
| No orphaned accounts | `ON DELETE RESTRICT` FK on `customer_id` and `product_id` in `accounts` |
| Idempotent origination | App-layer pre-check returns hard-stop dialog; `UNIQUE (customer_id, product_id, status)` is the DB backstop for race conditions |
| Eligibility re-validated at origination | `origination-service` re-assembles `CustomerSignals` and re-runs `evaluateEligibility` before any write |
| AI never makes an eligibility decision | `validateProductMembership()` in `llm-service` rejects any product_id not in the eligible set passed to that call — system prompt alone is insufficient |
| No protected-class data in AI payload | `CustomerSignals` type structurally excludes name, DOB, and protected fields; assembled from explicit allow-listed query projection |
| Dismissed products excluded for 90 days | `dismissed_until` timestamp checked in `POST /api/recommendations` before eligibility evaluation |
| Deposit amount validated server-side | `product.requires_deposit` checked in `POST /api/originate`; deposit products require `> 0`, non-deposit require `= 0` |
| Compliance audit always persisted | `eligibility_audit` rows inserted atomically with `recommendations` rows in same DB transaction |
| Aggregator is a clean swap point | `AggregatorProvider` interface in `lib/aggregator/interface.ts`; implementation selected by `AGGREGATOR_PROVIDER` env var |

---

## Environment Variables

```
DATABASE_URL          # Postgres connection string (Supabase / Neon)
ANTHROPIC_API_KEY     # Claude API key
FRED_API_KEY          # FRED API key (free at stlouisfed.org)
AGGREGATOR_PROVIDER   # "mock" (default) | "plaid"
```
