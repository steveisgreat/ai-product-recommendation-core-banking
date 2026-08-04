-- Migration: 001_initial_schema.sql
-- Idempotent: all statements use CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
-- Requires: Postgres 13+ (gen_random_uuid() is built-in; no pgcrypto extension needed)

-- -----------------------------------------------------------------------------
-- customers
-- No age/DOB column — protected-class data is never stored in this table.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name             TEXT        NOT NULL,
  household_size        INTEGER     NOT NULL CHECK (household_size >= 1),
  household_income_band TEXT        NOT NULL CHECK (household_income_band IN (
                            'LOW', 'LOWER_MIDDLE', 'MIDDLE', 'UPPER_MIDDLE', 'HIGH'
                        )),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- products
-- eligibility_rules: JSONB array of rule objects evaluated by the eligibility engine.
-- requires_deposit: true for deposit products (CHECKING, SAVINGS, CD, MONEY_MARKET),
--                   false for non-deposit products (CREDIT_CARD, HELOC, OVERDRAFT).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  account_type      TEXT        NOT NULL,
  requires_deposit  BOOLEAN     NOT NULL DEFAULT false,
  rate              NUMERIC(6,4),
  eligibility_rules JSONB       NOT NULL,
  description       TEXT        NOT NULL
);

-- -----------------------------------------------------------------------------
-- accounts (originated records)
-- UNIQUE (customer_id, product_id, status) is the DB-level backstop for idempotent
-- origination — prevents duplicate ACTIVE accounts for the same customer+product
-- even under race conditions.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    UUID         NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_id     UUID         NOT NULL REFERENCES products(id)  ON DELETE RESTRICT,
  account_type   TEXT         NOT NULL,
  balance        NUMERIC(15,2) NOT NULL DEFAULT 0.00,
  opened_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  status         TEXT         NOT NULL DEFAULT 'ACTIVE'
                                CHECK (status IN ('ACTIVE', 'CLOSED')),
  account_number CHAR(10)     NOT NULL,
  CONSTRAINT uq_account_number            UNIQUE (account_number),
  CONSTRAINT uq_active_customer_product   UNIQUE (customer_id, product_id, status)
);

-- -----------------------------------------------------------------------------
-- transactions (ledger entries)
-- Every account open, credit, or debit is recorded here.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID         NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount      NUMERIC(15,2) NOT NULL,
  type        TEXT         NOT NULL CHECK (type IN ('DEBIT', 'CREDIT', 'ACCOUNT_OPEN')),
  description TEXT         NOT NULL,
  posted_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- external_accounts (upserted by mock aggregator on each profile load)
-- ON DELETE CASCADE: removing a customer removes their linked external accounts.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS external_accounts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         UUID        NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  institution_name    TEXT        NOT NULL,
  account_type        TEXT        NOT NULL,
  masked_number       CHAR(4)     NOT NULL,
  approx_balance_band TEXT        NOT NULL CHECK (approx_balance_band IN (
                          'UNDER_1K', '1K_5K', '5K_25K', '25K_100K', 'OVER_100K'
                      )),
  last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- recommendations (one row per product per recommendation session)
-- session_id groups the 1–3 rows produced by a single banker request.
-- dismissed_until is set to now() + 90 days when a row is dismissed.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recommendations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID        NOT NULL,
  customer_id           UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_id            UUID        NOT NULL REFERENCES products(id)  ON DELETE RESTRICT,
  rank                  INTEGER     NOT NULL CHECK (rank BETWEEN 1 AND 3),
  rationale             TEXT        NOT NULL,
  compliance_note       TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'PENDING'
                                      CHECK (status IN ('PENDING', 'ORIGINATED', 'DISMISSED')),
  originated_account_id UUID        REFERENCES accounts(id),
  dismissed_until       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_customer ON recommendations(customer_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_session  ON recommendations(session_id);

-- -----------------------------------------------------------------------------
-- eligibility_audit (compliance officer access pattern — separate from recommendations)
-- session_id matches recommendations.session_id for the same request.
-- rules_evaluated: [{rule_key, description, passed, actual_value}]
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS eligibility_audit (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       UUID        NOT NULL,
  customer_id      UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_id       UUID        NOT NULL REFERENCES products(id)  ON DELETE RESTRICT,
  rules_evaluated  JSONB       NOT NULL,
  overall_eligible BOOLEAN     NOT NULL,
  evaluated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eligibility_audit_session ON eligibility_audit(session_id);
