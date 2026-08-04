# Implementation Tasks

## Task Dependency Graph

```
1 (Project Setup)
└── 2 (DB Schema + Migrations)
    └── 3 (Seed Data)
        ├── 4 (lib/db client + types)
        │   ├── 5 (lib/eligibility-engine)
        │   │   ├── 6 (lib/fred-service)
        │   │   │   └── 7 (lib/aggregator/)
        │   │   │       └── 8 (lib/recommendation-engine + lib/llm-service)
        │   │   │           └── 9 (lib/origination-service)
        │   │   │               ├── 10 (API routes — customers + products + aggregator)
        │   │   │               │   └── 11 (API routes — recommendations + origination + audit)
        │   │   │               │       ├── 12 (UI — CustomerListPage)
        │   │   │               │       │   └── 13 (UI — CustomerProfilePage shell)
        │   │   │               │       │       ├── 14 (UI — RecommendationPanel)
        │   │   │               │       │       ├── 15 (UI — RecommendationHistoryTable)
        │   │   │               │       │       └── 16 (UI — OriginationConfirmDialog)
        │   │   │               │       └── 17 (Property-based tests)
        │   │   │               └── 18 (Integration smoke test)
```

---

## Task 1: Project Scaffolding and Configuration

**Description:** Initialize the Next.js 14 App Router project with TypeScript, shadcn/ui, pnpm, and all required dependencies. Configure environment variable handling and Vercel deployment settings.

**Sub-tasks:**
- [ ] Run `pnpm create next-app@latest` with App Router + TypeScript options
- [ ] Install and initialize shadcn/ui (`pnpm dlx shadcn-ui@latest init`)
- [ ] Add required shadcn components: card, table, badge, button, dialog, drawer, skeleton, alert, alert-dialog, input
- [ ] Install dependencies: `@anthropic-ai/sdk`, `postgres` (or `@vercel/postgres`), `zod`, `uuid`
- [ ] Install dev dependencies: `@types/uuid`, testing framework (vitest + @vitest/coverage-v8)
- [ ] Create `.env.local.example` with all four env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `FRED_API_KEY`, `AGGREGATOR_PROVIDER`
- [ ] Add `vercel.json` with build configuration
- [ ] Configure `tsconfig.json` path aliases (`@/*` → `./src/*` or `./`)
- [ ] Add `vitest.config.ts`

**Acceptance criteria:** `pnpm build` completes without errors on a clean checkout with valid env vars.

**Requirements coverage:** R8 (data model integrity — establishes project foundation)

---

## Task 2: Database Schema and Migrations

**Description:** Create all SQL migration files for the eight tables defined in the design. Migrations must be idempotent and runnable in CI.

**Sub-tasks:**
- [ ] Create `migrations/001_initial_schema.sql` with all CREATE TABLE statements:
  - `customers` (no age/DOB column)
  - `products` (with `requires_deposit` boolean and `eligibility_rules` JSONB)
  - `accounts` (with `UNIQUE (customer_id, product_id, status)` constraint)
  - `transactions`
  - `external_accounts`
  - `recommendations` (with `dismissed_until TIMESTAMPTZ` nullable column)
  - `eligibility_audit`
- [ ] Add all indexes from design: `idx_recommendations_customer`, `idx_recommendations_session`, `idx_eligibility_audit_session`
- [ ] Add all FK constraints with `ON DELETE RESTRICT` (or `ON DELETE CASCADE` for `external_accounts`)
- [ ] Add all CHECK constraints (status enums, balance_band enum, income_band enum, rank 1–3)
- [ ] Add `UNIQUE (account_number)` and `UNIQUE (customer_id, product_id, status)` constraints on `accounts`
- [ ] Create `scripts/migrate.ts` that runs migrations against `DATABASE_URL`
- [ ] Verify migration is idempotent (safe to run twice)

**Acceptance criteria:** Running `pnpm migrate` against a fresh Postgres database creates all tables, indexes, and constraints without errors. Running it a second time does not fail.

**Requirements coverage:** R8.1–R8.5 (data schema enforcement, FK relationships, account number uniqueness)

**Depends on:** Task 1

---

## Task 3: Seed Data

**Description:** Create seed data for the product catalog (with FRED-derived rates as placeholders), 5 demo customers, their core accounts and transactions, and the 5 mock aggregator fixture profiles.

**Sub-tasks:**
- [ ] Create `lib/eligibility-rules.ts` exporting `RULE_KEYS` as a `const` object containing every valid rule_key string used in product eligibility rules (e.g. `RULE_KEYS.NO_EXISTING_CHECKING = 'no_existing_checking'`). This is the single source of truth imported by both seed data (Task 3) and the eligibility engine predicate map (Task 5).
- [ ] Create `scripts/seed.ts`
- [ ] Seed 7 products with structured `eligibility_rules` JSONB and `requires_deposit` flags — **all `rule_key` values in the JSONB must use string values from `RULE_KEYS`** (import and reference the const, do not hardcode literal strings):
  - Checking Account (`requires_deposit: true`)
  - High-Yield Savings (`requires_deposit: true`)
  - Certificate of Deposit 12mo (`requires_deposit: true`)
  - Money Market Account (`requires_deposit: true`)
  - Credit Card (`requires_deposit: false`)
  - HELOC (`requires_deposit: false`)
  - Overdraft Protection (`requires_deposit: false`)
- [ ] Seed 5 demo customers with varied `household_income_band` and `household_size`
- [ ] Seed core accounts for each customer (varied types/balances to exercise eligibility rules)
- [ ] Seed transaction history (3–6 months of DEBIT/CREDIT entries per customer; include at least one customer with `OVERDRAFT_LAST_90D` signal derivable from transaction data)
- [ ] Seed external_accounts fixture rows for the 5 aggregator profiles defined in design
- [ ] Add `pnpm seed` script to `package.json`

**Acceptance criteria:** `pnpm seed` runs without errors and produces a queryable dataset. `SELECT count(*) FROM products` returns 7. Each customer has at least one account and 10+ transactions. No `rule_key` string literal appears in `scripts/seed.ts` — all reference `RULE_KEYS` from `lib/eligibility-rules.ts`.

**Requirements coverage:** R2.4 (product catalog with ≥6 products), R7.4 (varied aggregator fixture data)

**Depends on:** Task 2

---

## Task 4: Database Client and Shared Types

**Description:** Implement `lib/db/index.ts` with the Postgres client and all shared TypeScript types derived from the schema.

**Sub-tasks:**
- [ ] Implement `lib/db/index.ts` exporting a configured `postgres` (or `@vercel/postgres`) client
- [ ] Define and export TypeScript types matching every DB table:
  - `Customer`, `Product`, `Account`, `Transaction`, `ExternalAccount`
  - `Recommendation`, `EligibilityAudit`
- [ ] Define shared enums: `BalanceBand`, `IncomeBand`, `AccountStatus`, `RecommendationStatus`
- [ ] Define `CustomerSignals` type (the anonymized struct — structurally excludes name, DOB, protected fields)
- [ ] Implement helper: `assembleCustomerSignals(customerId: string): Promise<CustomerSignals>` — queries DB, derives balance bands, inflow bands, transaction pattern flags, tenure, existing product IDs
- [ ] Write unit test: `assembleCustomerSignals` for a seeded customer returns a valid `CustomerSignals` with no protected-class fields present

**Acceptance criteria:** TypeScript compiles cleanly. `assembleCustomerSignals` test passes. The `CustomerSignals` type has no `name`, `dob`, `age`, or protected-class fields.

**Requirements coverage:** R8.1–R8.2 (schema enforcement), R2.3 (no protected-class data in signals), R4.4

**Depends on:** Task 3

---

## Task 5: Eligibility Engine

**Description:** Implement `lib/eligibility-engine.ts` as a pure, side-effect-free function that evaluates all products against a `CustomerSignals` struct and returns eligible products plus a machine-readable audit record.

**Sub-tasks:**
- [ ] Import `RULE_KEYS` from `lib/eligibility-rules.ts` (created in Task 3)
- [ ] Implement `evaluateEligibility(signals: CustomerSignals, products: Product[]): EligibilityResult`
- [ ] Implement rule predicate map keyed on values from `RULE_KEYS` (do not use string literals) — one predicate per key:
  - `RULE_KEYS.NO_EXISTING_CHECKING`, `NO_EXISTING_SAVINGS`, `NO_EXISTING_CD`, `NO_EXISTING_MMA`, `NO_EXISTING_CREDIT_CARD`, `NO_EXISTING_HELOC`, `NO_EXISTING_OVERDRAFT`
  - `MIN_TENURE_MONTHS_3`, `MIN_TENURE_MONTHS_6`
  - `MIN_BALANCE_BAND_1K_5K`, `MIN_BALANCE_BAND_5K_25K`, `MIN_BALANCE_BAND_25K_100K`
  - `NO_OVERDRAFT_LAST_90D`
  - `MIN_INCOME_BAND_MIDDLE`, `MIN_INCOME_BAND_UPPER_MIDDLE`
  - `HAS_EXTERNAL_ACCOUNT`
  - `HAS_EXISTING_CHECKING`
- [ ] **Unknown rule_key must throw, not silently skip**: if `evaluateEligibility` encounters a `rule_key` in a product's `eligibility_rules` that has no matching entry in the predicate map, it must throw an `Error` (e.g. `UnknownRuleKeyError`) — silent non-matching is a bug risk
- [ ] Each `AuditRecord` includes `rule_key`, `description`, `passed`, `actual_value`
- [ ] Return only products where ALL rules pass
- [ ] Write unit test: calling `evaluateEligibility` with a product containing an unrecognised `rule_key` throws `UnknownRuleKeyError`
- [ ] Write unit test: every value in `RULE_KEYS` has a corresponding predicate entry in the map (contract coverage test — fails at build time if a key is added to `RULE_KEYS` without a matching predicate)
- [ ] Write property-based tests (vitest + fast-check):
  - **Property**: if `existing_product_ids` contains product P's ID, P is never in the eligible set
  - **Property**: a customer with `balance_band = UNDER_1K` is never eligible for CD, MMA, or HELOC
  - **Property**: `audit` array always contains one entry per product per rule evaluated
  - **Property**: `eligible` is always a subset of the input `products` array

**Acceptance criteria:** All property tests and unit tests pass with 100+ cases each. Function is pure (no I/O). TypeScript compiles. Unknown rule_key throws loudly. Every `RULE_KEYS` value has a predicate — the coverage test enforces this at the test layer.

**Requirements coverage:** R2.1–R2.6 (eligibility evaluation, no protected-class data, audit record)

**Depends on:** Task 4

---

## Task 6: FRED Rate Service

**Description:** Implement `lib/fred-service.ts` to fetch the latest Federal Funds Rate from the FRED API and compute product rate spreads.

**Sub-tasks:**
- [ ] Implement `getFredRates(): Promise<Record<string, number>>` returning a map of account_type → rate (%)
- [ ] Fetch `FEDFUNDS` series from `https://api.stlouisfed.org/fred/series/observations` with `sort_order=desc&limit=1`
- [ ] Apply spread formulas from design (prime = fed_rate + 3.00%):
  - CHECKING: 0.00%
  - SAVINGS: fed_rate + 0.50%
  - MONEY_MARKET: fed_rate + 0.25%
  - CD_12MO: fed_rate + 1.00%
  - CREDIT_CARD: prime_rate + 12.99%
  - HELOC: prime_rate + 1.50%
  - OVERDRAFT: prime_rate + 8.00%
- [ ] Use Next.js `fetch` with `{ next: { revalidate: 86400 } }` for 24h caching
- [ ] Implement fallback: if FRED API returns non-200 or throws, return hardcoded fallback rates (based on ~5.25% fed rate)
- [ ] Write unit test: fallback rates are returned when FRED fetch fails

**Acceptance criteria:** `getFredRates()` returns a valid rate map. Unit test for fallback passes. No test should hit the real FRED API (mock the fetch).

**Requirements coverage:** Design constraint (FRED-derived rates)

**Depends on:** Task 4

---

## Task 7: Mock Aggregator Service

**Description:** Implement `lib/aggregator/` with the `AggregatorProvider` interface, the mock implementation, and the provider selector. This establishes the clean Plaid swap point.

**Sub-tasks:**
- [ ] Create `lib/aggregator/interface.ts` with `ExternalAccount` type and `AggregatorProvider` interface
- [ ] Create `lib/aggregator/mock-provider.ts` implementing `AggregatorProvider`:
  - Returns fixture data keyed on customer UUID
  - 5 fixture entries: (1) empty, (2) one checking at Chase, (3) savings at Ally + checking at BofA, (4) investment at Fidelity, (5) three accounts at Wells Fargo / Marcus / Schwab
  - Returns empty array for unknown customer IDs (no error thrown)
- [ ] Create `lib/aggregator/index.ts` exporting `getProvider(): AggregatorProvider` — reads `AGGREGATOR_PROVIDER` env var, returns mock by default
- [ ] Write unit tests:
  - Known customer ID returns correct fixture data
  - Unknown customer ID returns empty array
  - Response shape matches `ExternalAccount` interface

**Acceptance criteria:** All unit tests pass. Adding a new provider requires only implementing `AggregatorProvider` and updating the env var — no other code changes.

**Requirements coverage:** R7.1–R7.5 (mock aggregator endpoint, fixture data, 200 on unknown ID)

**Depends on:** Task 4

---

## Task 8: LLM Service and Recommendation Engine

**Description:** Implement `lib/llm-service.ts` (Anthropic SDK wrapper with Zod validation and product membership check) and `lib/recommendation-engine.ts` (orchestrator).

**Sub-tasks:**

### lib/llm-service.ts
- [ ] Install and configure `@anthropic-ai/sdk`
- [ ] Implement `getRecommendations(signals: CustomerSignals, eligibleProducts: Product[]): Promise<RecommendationOutput>`
- [ ] Set model to `claude-haiku-4-5-20251001`, `max_tokens: 1024`
- [ ] Assemble system prompt (enforce: use only provided fields, no protected-class references, strict JSON output, products from eligible list only)
- [ ] Assemble user message payload as structured JSON (customer_signals + eligible_products)
- [ ] Define `RecommendationOutputSchema` with Zod (recommendations array 1–3, each with product_id UUID, rank 1–3, rationale max 600 chars, compliance_note; plus session_compliance_note)
- [ ] Implement `validateProductMembership(parsed, eligibleProducts)`: throws `LLMServiceError('INVALID_PRODUCT_ID')` for any product_id not in the eligible set
- [ ] Apply 10-second timeout via `AbortController`; throw `LLMServiceError('TIMEOUT')` on expiry
- [ ] Write unit tests (mock Anthropic SDK):
  - Valid response parses and passes membership check
  - product_id not in eligible set throws `LLMServiceError('INVALID_PRODUCT_ID')`
  - Malformed JSON response throws `LLMServiceError`
  - Timeout throws `LLMServiceError('TIMEOUT')`

### lib/products-with-rates.ts (shared helper — implement in this task)
- [ ] Create `lib/products-with-rates.ts` exporting `getProductsWithRates(): Promise<Product[]>`
- [ ] Implementation: fetch all products from DB, call `getFredRates()`, merge live rates into the product objects (overriding `product.rate` with the FRED-derived value); fall through to `product.rate` only if `getFredRates()` fails
- [ ] This helper is the single source of truth for product rates — both `recommendation-engine` and `/api/products` must call it; neither may apply rates independently

### lib/recommendation-engine.ts
- [ ] Implement `generateRecommendations(customerId: string): Promise<RecommendationEngineResult>`
- [ ] Step 1: call `assembleCustomerSignals(customerId)`
- [ ] Step 2: query active dismissals (`dismissed_until > now()`) and remove those product_ids from candidate set
- [ ] Step 3: call `getProductsWithRates()` to get the live-rated product list; call `evaluateEligibility(signals, candidateProducts)`
- [ ] Step 4: if `eligible.length === 0`, return `{ eligible: false }` — do not call LLM
- [ ] Step 5: call `llm-service.getRecommendations(signals, eligible)` — eligible products already carry live FRED-derived rates, so the LLM reasons about the same rates the UI will display
- [ ] Step 6: generate `session_id` (UUID)
- [ ] Step 7: in a single DB transaction: INSERT recommendations rows (1–3) + INSERT eligibility_audit rows (one per product evaluated)
- [ ] Step 8: return `{ sessionId, recommendations[], sessionComplianceNote }`
- [ ] Propagate `LLMServiceError` to API layer without persisting anything

**Acceptance criteria:** Unit tests pass with mocked dependencies. `validateProductMembership` is called after every Zod parse — never skipped. LLM errors do not result in partial DB writes.

**Requirements coverage:** R2.1, R3.1–R3.6, R4.1–R4.5 (recommendation generation, compliance note, LLM error handling)

**Depends on:** Tasks 5, 6, 7

---

## Task 9: Origination Service

**Description:** Implement `lib/origination-service.ts` — the atomic account creation + ledger entry service with deposit amount validation, eligibility re-check, and duplicate guard.

**Sub-tasks:**
- [ ] Implement `originateAccount(params: { customerId, productId, recommendationId, depositAmount }): Promise<OriginationResult>`
- [ ] Step 1: fetch `product.requires_deposit`; validate `depositAmount`:
  - `requires_deposit = true` AND `depositAmount <= 0` → throw `OriginationError('DEPOSIT_REQUIRED')`
  - `requires_deposit = false` AND `depositAmount !== 0` → throw `OriginationError('DEPOSIT_NOT_ALLOWED')`
- [ ] Step 2: re-assemble `CustomerSignals`; re-run `evaluateEligibility`; if product not in eligible set → return `{ success: false, notEligible: true }`
- [ ] Step 3: query for existing ACTIVE account (`customer_id + product_id + status=ACTIVE`); if found → return `{ success: false, duplicate: true, existingAccount }`
- [ ] Step 4: generate unique 10-digit `account_number`; retry up to 3× on `uq_account_number` violation; after 3 failures throw `OriginationError('ACCOUNT_NUMBER_EXHAUSTED')`
- [ ] Step 5: open Postgres transaction:
  - INSERT `accounts` (status=ACTIVE, balance=depositAmount, account_number)
  - INSERT `transactions` (type=ACCOUNT_OPEN, amount=depositAmount, posted_at=now())
  - UPDATE `recommendations` SET status=ORIGINATED, originated_account_id=<new id> WHERE id=recommendationId
  - COMMIT; on any error ROLLBACK and throw
- [ ] Step 6: return `{ success: true, account: AccountRecord }`
- [ ] Write property-based tests:
  - **Property**: originating the same (customerId, productId) twice always results in duplicate detection on the second call (no second account created)
  - **Property**: if `requires_deposit = true` and `depositAmount <= 0`, no DB rows are written
  - **Property**: on DB error, neither the account row nor the transaction row exists (rollback verified)

**Acceptance criteria:** All property tests pass. Transaction atomicity verified: no partial writes on error.

**Requirements coverage:** R5.1–R5.7 (origination, ledger entry, rollback, duplicate prevention, deposit amount)

**Depends on:** Tasks 5, 8

---

## Task 10: API Routes — Customers, Products, Aggregator

**Description:** Implement the read-only API routes that support the customer profile page.

**Sub-tasks:**

### GET /api/customers
- [ ] Create `app/api/customers/route.ts`
- [ ] Query all customers; support optional `?search=` filter (case-insensitive name match)
- [ ] Return `CustomerSummary[]` (id, full_name, household_income_band, created_at)

### GET /api/customers/[id]
- [ ] Create `app/api/customers/[id]/route.ts`
- [ ] Return customer + accounts[] + transactionSummary (totalDebits, totalCredits, avgMonthlyInflow)
- [ ] Return 404 if customer not found

### GET /api/products
- [ ] Create `app/api/products/route.ts`
- [ ] Call `getProductsWithRates()` from `lib/products-with-rates.ts` — do not apply rates directly in this route handler
- [ ] Use Next.js `fetch` cache with `revalidate: 86400` (the caching is implemented inside `getProductsWithRates` via `getFredRates`)

### GET /api/mock-aggregator/[customerId]
- [ ] Create `app/api/mock-aggregator/[customerId]/route.ts`
- [ ] Call `getProvider().getAccounts(customerId)`
- [ ] Upsert returned accounts into `external_accounts` table (INSERT ... ON CONFLICT DO UPDATE)
- [ ] Always return HTTP 200 with `{ accounts: ExternalAccount[] }`
- [ ] Respond within 500ms for all fixture requests

**Acceptance criteria:** All routes return correct shape and status codes. Mock aggregator returns 200 with empty array for unknown customer IDs. Products route returns rates.

**Requirements coverage:** R1.1–R1.5, R7.1–R7.5

**Depends on:** Tasks 7, 8

---

## Task 11: API Routes — Recommendations, Origination, Audit

**Description:** Implement the write and query API routes for the core recommendation and origination workflows.

**Sub-tasks:**

### POST /api/recommendations
- [ ] Create `app/api/recommendations/route.ts`
- [ ] Validate body: `customerId` required, must be UUID
- [ ] Call `generateRecommendations(customerId)` from recommendation-engine
- [ ] If `{ eligible: false }`, return `{ eligible: false }` with 200
- [ ] On `LLMServiceError`, return `{ error, code }` with 500 and log failure (no DB write)
- [ ] Return `{ sessionId, recommendations[], sessionComplianceNote }`

### GET /api/recommendations/[customerId]
- [ ] Create `app/api/recommendations/[customerId]/route.ts`
- [ ] Query recommendations grouped by session_id, ordered by created_at DESC
- [ ] Return `RecommendationSession[]` (session_id, created_at, products[], sessionComplianceNote, status per product)

### PATCH /api/recommendations/[recommendationId]/dismiss
- [ ] Create `app/api/recommendations/[recommendationId]/dismiss/route.ts`
- [ ] Validate row exists and status is PENDING; return 404/409 otherwise
- [ ] UPDATE: status=DISMISSED, dismissed_until=now() + interval '90 days'
- [ ] Return updated recommendation row

### POST /api/originate
- [ ] Create `app/api/originate/route.ts`
- [ ] Validate body: recommendationId, customerId, productId (all UUIDs), depositAmount (number)
- [ ] Call `originateAccount(...)` from origination-service
- [ ] Map result variants to HTTP responses:
  - `notEligible` → 422
  - `duplicate` → 200 with `{ duplicate: true, existingAccount }`
  - `success` → 201 with `{ account: AccountRecord }`
- [ ] On `OriginationError('DEPOSIT_REQUIRED' | 'DEPOSIT_NOT_ALLOWED')` → 422

### GET /api/eligibility-audit/[sessionId]
- [ ] Create `app/api/eligibility-audit/[sessionId]/route.ts`
- [ ] Return all `eligibility_audit` rows for the session_id
- [ ] Return 404 if no rows found

**Acceptance criteria:** All routes return correct status codes and response shapes. Dismiss route sets `dismissed_until`. Originate route returns 201 on success, 422 on deposit validation failure, 422 on ineligible.

**Requirements coverage:** R3.1–R3.5, R4.5, R5.1–R5.7, R6.3

**Depends on:** Tasks 9, 10

---

## Task 12: UI — Customer List Page

**Description:** Implement `app/customers/page.tsx` — the entry point for the banker to find and select a customer.

**Sub-tasks:**
- [ ] Create `app/customers/page.tsx` as a Server Component
- [ ] Fetch customers from `GET /api/customers` server-side
- [ ] Implement `CustomerSearchTable` client component using shadcn DataTable:
  - Columns: name, income band, number of accounts, member since
  - Client-side search/filter by name (no server round-trip needed for demo scale)
  - Row click navigates to `/customers/[id]`
- [ ] Create `app/layout.tsx` with sidebar nav (logo, "Customers" link, search shortcut)
- [ ] Create `app/page.tsx` redirecting to `/customers`
- [ ] Ensure page is accessible (semantic table markup, keyboard navigation)

**Acceptance criteria:** Page renders all seeded customers. Typing in search filters the list. Clicking a row navigates to the profile page.

**Requirements coverage:** R1.1 (customer selection)

**Depends on:** Task 11

---

## Task 13: UI — Customer Profile Page Shell

**Description:** Implement the `CustomerProfilePage` layout with `CustomerProfileCard`, `CoreAccountsPanel`, and `ExternalAccountsPanel` (with non-blocking aggregator loading and graceful error state).

**Sub-tasks:**
- [ ] Create `app/customers/[id]/page.tsx` as a Server Component — fetches `GET /api/customers/[id]` server-side
- [ ] Implement `CustomerProfileCard` (shadcn Card): displays full_name, household_size, income_band, tenure in months
- [ ] Implement `CoreAccountsPanel` (shadcn Table): columns — account type, account number, balance, status, opened date
- [ ] Implement `ExternalAccountsPanel` as a Client Component (`"use client"`):
  - On mount, fetch `GET /api/mock-aggregator/[customerId]`
  - Show shadcn Skeleton while loading
  - Show shadcn Alert (warning variant) if fetch errors or times out after 3 seconds — profile page must still render with core data
  - Show external accounts in a visually distinct Card with a label indicating external institution data
  - Each row: institution name, account type, masked number, balance band
- [ ] Add 404 handling: if customer not found by API, show not-found page

**Acceptance criteria:** Profile page renders within 2 seconds for core data (server-side fetch). External accounts section loads independently without blocking the page. Aggregator timeout/error shows non-blocking warning without crashing the page.

**Requirements coverage:** R1.1–R1.4, R7.4

**Depends on:** Task 12

---

## Task 14: UI — Recommendation Panel

**Description:** Implement `RecommendationPanel` and `RecommendationCard` components on the customer profile page — the primary banker interaction surface.

**Sub-tasks:**
- [ ] Implement `RecommendationPanel` as a Client Component (`"use client"`):
  - Idle state: "Get Recommendation" Button
  - Loading state: three shadcn Skeleton cards
  - Error state: shadcn Alert (destructive) with error message
  - No-eligible state: shadcn Alert (info) — "No eligible products found for this customer"
  - Results state: renders 1–3 `RecommendationCard` components + `ComplianceNoteDrawer`
- [ ] Implement `RecommendationCard` (shadcn Card):
  - Badge showing rank (#1, #2, #3)
  - Product name, rate (formatted as %), description
  - Rationale text (1–2 sentences)
  - `DepositAmountInput` (shadcn Input, type=number, min=1) — shown only when `product.requires_deposit = true`
  - "Originate" Button — disabled until depositAmount > 0 for deposit products
  - "Dismiss" Button — calls `PATCH /api/recommendations/[recommendationId]/dismiss`; removes card from view on success
- [ ] Implement `ComplianceNoteDrawer` (shadcn Drawer or collapsible section):
  - Collapsed by default
  - Shows `session_compliance_note` text from LLM response
  - Label: "Compliance & Fairness Note"
- [ ] On dismiss success, update local state to hide that specific card (other cards remain)
- [ ] On "Get Recommendation" click: POST `/api/recommendations`; replace results if a prior session exists

**Acceptance criteria:** "Get Recommendation" triggers API call and shows loading state. Recommendations render with rank, rationale, and product info. Dismissing one card hides it without affecting others. Deposit amount input is only shown for deposit products. Compliance note is collapsible.

**Requirements coverage:** R3.1–R3.6, R4.1–R4.3

**Depends on:** Task 13

---

## Task 15: UI — Recommendation History Table

**Description:** Implement `RecommendationHistoryTable` on the customer profile page, showing the full recommendation log with expandable eligibility audit rows.

**Sub-tasks:**
- [ ] Implement `RecommendationHistoryTable` as a Client Component:
  - Fetch `GET /api/recommendations/[customerId]` on mount
  - Display sessions in reverse-chronological order
  - Columns per session row: date/time, products suggested (comma-separated names), outcome badges (PENDING / ORIGINATED / DISMISSED)
  - Compliance note shown as truncated text with expand toggle
- [ ] Implement expandable row → `EligibilityAuditDetail`:
  - On expand, fetch `GET /api/eligibility-audit/[sessionId]`
  - Render as a nested table: product name | rule description | pass/fail badge | actual value
  - Show all products evaluated (not just eligible ones)
- [ ] Use outcome badge colors: PENDING=gray, ORIGINATED=green, DISMISSED=orange

**Acceptance criteria:** History table renders all seeded recommendation sessions for a customer in reverse-chronological order. Expanding a session row fetches and renders the eligibility audit detail. Outcome badges display correct colors.

**Requirements coverage:** R6.1–R6.5 (recommendation history, compliance note, eligibility audit display)

**Depends on:** Task 13

---

## Task 16: UI — Origination Confirm Dialog

**Description:** Implement `OriginationConfirmDialog` and wire the full origination flow end-to-end from the `RecommendationCard` "Originate" button through the API.

**Sub-tasks:**
- [ ] Implement `OriginationConfirmDialog` (shadcn AlertDialog):
  - **Normal case**: title "Open [Product Name]?", body shows depositAmount for deposit products (e.g. "Opening deposit: $500.00") or nothing for non-deposit products. "Confirm" and "Cancel" buttons.
  - **Duplicate case**: title "Account Already Exists", body "This customer already holds an active [Product Name] (account #XXXXXXXXXX, opened MM/DD/YYYY)." Only a "Close" button — no origination option.
  - **Loading state**: "Confirm" button shows spinner and is disabled during API call
  - **Error state**: inline Alert (destructive) inside dialog on API error
- [ ] Wire "Confirm" button to `POST /api/originate` with `{ recommendationId, customerId, productId, depositAmount }`
- [ ] On success (201): close dialog, show success toast, update `RecommendationCard` to show originated state (disable Originate button, show account number)
- [ ] On duplicate (200 + `{ duplicate: true }`): switch dialog to duplicate hard-stop view
- [ ] On 422 (deposit validation): show inline error in dialog
- [ ] After successful origination: refresh `RecommendationHistoryTable` and `CoreAccountsPanel`

**Acceptance criteria:** Full origination flow works end-to-end with seeded data. Duplicate case shows hard-stop (no origination button). Success shows account number on the card. History table refreshes after origination. Origination completes within 3 seconds.

**Requirements coverage:** R5.1–R5.7

**Depends on:** Tasks 14, 15

---

## Task 17: Property-Based Test Suite

**Description:** Implement the full property-based test suite covering all core correctness properties of the system.

**Sub-tasks:**
- [ ] Install `fast-check` as a dev dependency
- [ ] **Eligibility engine properties** (extend Task 5 tests):
  - Property: `evaluateEligibility` is deterministic — same inputs always produce same outputs
  - Property: no product in `eligible` output has an `overall_eligible = false` audit record
  - Property: the full `audit` array covers every input product
- [ ] **LLM service properties** (mock Claude responses):
  - Property: any response containing a product_id outside the eligible set always throws `LLMServiceError('INVALID_PRODUCT_ID')`
  - Property: rank values in a valid response are always a contiguous sequence starting at 1
- [ ] **Origination service properties** (extend Task 9 tests):
  - Property: two concurrent origination calls for the same (customerId, productId) result in exactly one ACTIVE account (DB constraint + application logic)
  - Property: `accounts.balance` always equals the `depositAmount` passed at origination
  - Property: every `accounts` row has exactly one corresponding `transactions` row with type=ACCOUNT_OPEN
- [ ] **Dismissal cooldown property**:
  - Property: a product dismissed within the last 90 days never appears in the eligible set for `generateRecommendations`
- [ ] Run all tests with `pnpm test`; achieve 100% pass rate

**Acceptance criteria:** All property tests pass with ≥100 generated cases each. `pnpm test` exits 0.

**Requirements coverage:** R2, R3, R5 (correctness properties for eligibility, recommendations, origination)

**Depends on:** Tasks 9, 11

---

## Task 18: End-to-End Smoke Test and README

**Description:** Write a single end-to-end smoke test covering the happy path, and document the project setup in README.md.

**Sub-tasks:**
- [ ] Write `tests/e2e/happy-path.test.ts` (vitest, against a test DB with seed data):
  1. Call `GET /api/customers` — expect ≥1 customer
  2. Call `GET /api/customers/[id]` — expect customer with accounts
  3. Call `GET /api/mock-aggregator/[customerId]` — expect 200
  4. Call `POST /api/recommendations` — expect sessionId + 1–3 recommendations
  5. Call `PATCH /api/recommendations/[recommendationId]/dismiss` on rec 2 or 3 — expect DISMISSED + dismissed_until set
  6. Call `POST /api/originate` with rec 1 and valid depositAmount — expect 201 + AccountRecord
  7. Call `GET /api/recommendations/[customerId]` — expect ORIGINATED status on rec 1
  8. Call `GET /api/eligibility-audit/[sessionId]` — expect audit records
  9. Repeat `POST /api/originate` for same product — expect `{ duplicate: true }`
- [ ] Create `README.md` with:
  - Project overview and architecture summary
  - Prerequisites (Node 18+, pnpm, Postgres, env vars needed)
  - Setup: `pnpm install` → `pnpm migrate` → `pnpm seed` → `pnpm dev`
  - Running tests: `pnpm test`
  - Environment variable reference (all 4 vars with descriptions)
  - Note on swapping mock aggregator for Plaid

**Acceptance criteria:** Smoke test passes end-to-end against the seeded test database. README is complete and accurate.

**Requirements coverage:** All requirements (integration verification)

**Depends on:** Tasks 16, 17
