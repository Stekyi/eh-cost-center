-- =====================================================================
-- EH Cost Center — Neon Postgres schema (Firebase → Neon migration)
-- =====================================================================
-- Design principle (per migration brief): PRESERVE Firestore document
-- structure initially. Every collection becomes a table with:
--   * id    TEXT PRIMARY KEY   -- the original Firestore document id
--   * data  JSONB NOT NULL     -- the full document, verbatim
-- Query/sort/filter fields the app actually uses are exposed as
-- GENERATED columns derived from `data`, so we get real SQL indexes
-- without duplicating writes or drifting from the source document.
-- Firestore Timestamps are exported as ISO-8601 strings. Timestamp query
-- columns are GENERATED as TEXT (not timestamptz): text::timestamptz is not
-- IMMUTABLE so Postgres rejects it in a generated column, and ISO-8601 strings
-- sort chronologically as text — so ORDER BY / range filters work correctly.
--
-- Run once against a fresh Neon database:
--   psql "$NEON_DATABASE_URL" -f db/schema.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector, replaces rag_embeddings cosine search
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid() for server-generated ids

-- ---------------------------------------------------------------------
-- AUTH — replaces Firebase Authentication.
-- Firebase scrypt password hashes cannot be imported into a non-Firebase
-- system, so passwords are NOT migrated. Users are re-created with a
-- null password_hash + a one-time reset token (see scripts/migrate/migrate-users.js).
-- Roles that were Firebase custom claims (admin / assistant / videographer)
-- become the `role` column; anything else is preserved in custom_claims.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  uid            TEXT PRIMARY KEY,                 -- keep original Firebase uid (customers/{uid} FK relies on it)
  email          TEXT UNIQUE,
  password_hash  TEXT,                             -- bcrypt; NULL until user completes reset
  role           TEXT,                             -- 'admin' | 'assistant' | 'videographer' | NULL (customer)
  custom_claims  JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_name   TEXT,
  disabled       BOOLEAN NOT NULL DEFAULT false,
  reset_token    TEXT,                             -- one-time cutover / forgot-password token
  reset_expires  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);
CREATE INDEX IF NOT EXISTS users_reset_token_idx ON users (reset_token);

-- ---------------------------------------------------------------------
-- Generic document collections (full-CRUD, no special query needs).
-- Simple JSONB doc stores + audit timestamps + a GIN index for ad-hoc
-- containment queries.
-- ---------------------------------------------------------------------

-- customers -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id          TEXT PRIMARY KEY,                    -- == Firebase uid for app-created customers
  data        JSONB NOT NULL,
  name        TEXT        GENERATED ALWAYS AS (data->>'name') STORED,
  created_at  TEXT GENERATED ALWAYS AS (NULLIF(data->>'createdAt','')) STORED,
  updated_at  TEXT GENERATED ALWAYS AS (NULLIF(data->>'modifiedAt','')) STORED
);
CREATE INDEX IF NOT EXISTS customers_name_idx ON customers (name);            -- orderBy('name')
CREATE INDEX IF NOT EXISTS customers_data_gin ON customers USING gin (data);

-- products ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  created_at  TEXT GENERATED ALWAYS AS (NULLIF(data->>'createdAt','')) STORED,
  updated_at  TEXT GENERATED ALWAYS AS (NULLIF(data->>'modifiedAt','')) STORED
);
CREATE INDEX IF NOT EXISTS products_data_gin ON products USING gin (data);

-- orders --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL,
  customer_id  TEXT        GENERATED ALWAYS AS (data->>'customerId') STORED,
  paid         BOOLEAN     GENERATED ALWAYS AS ((data->>'paid')::boolean) STORED,
  delivered    BOOLEAN     GENERATED ALWAYS AS ((data->>'delivered')::boolean) STORED,
  status       TEXT        GENERATED ALWAYS AS (data->>'status') STORED,
  created_at   TEXT GENERATED ALWAYS AS (NULLIF(data->>'createdAt','')) STORED
);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);      -- orderBy('createdAt','desc')
CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders (customer_id);         -- where customerId ==
-- Composite index for CreateDeliveryAssignment: where paid==true AND delivered==false
CREATE INDEX IF NOT EXISTS orders_paid_delivered_idx ON orders (paid, delivered);
-- productIds array-contains  →  GIN on the JSON array
CREATE INDEX IF NOT EXISTS orders_product_ids_gin ON orders USING gin ((data->'productIds'));

-- orders/{orderId}/payments  →  flat table with FK
CREATE TABLE IF NOT EXISTS order_payments (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  data        JSONB NOT NULL,
  recorded_at TEXT GENERATED ALWAYS AS (NULLIF(data->>'recordedAt','')) STORED
);
CREATE INDEX IF NOT EXISTS order_payments_order_id_idx ON order_payments (order_id);

-- revenue -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  order_id    TEXT        GENERATED ALWAYS AS (data->>'orderId') STORED,
  created_at  TEXT GENERATED ALWAYS AS (NULLIF(data->>'createdAt','')) STORED
);
CREATE INDEX IF NOT EXISTS revenue_created_at_idx ON revenue (created_at DESC);    -- orderBy('createdAt','desc') limit 5
CREATE INDEX IF NOT EXISTS revenue_order_id_idx ON revenue (order_id);             -- where orderId == (delete cascade / lookup)

-- expenseItems (+ audit + archive) ------------------------------------
CREATE TABLE IF NOT EXISTS expense_items (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  value_date  TEXT GENERATED ALWAYS AS (NULLIF(data->>'valueDate','')) STORED,
  created_at  TEXT GENERATED ALWAYS AS (NULLIF(data->>'createdAt','')) STORED
);
CREATE INDEX IF NOT EXISTS expense_items_value_date_idx ON expense_items (value_date DESC);

CREATE TABLE IF NOT EXISTS expense_items_audit (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL,
  created_at TEXT GENERATED ALWAYS AS (NULLIF(data->>'createdAt','')) STORED
);
CREATE TABLE IF NOT EXISTS expense_items_archive (
  id         TEXT PRIMARY KEY,
  data       JSONB NOT NULL
);

-- expenseCategories ---------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_categories (
  id    TEXT PRIMARY KEY,
  data  JSONB NOT NULL,
  code  TEXT GENERATED ALWAYS AS (data->>'code') STORED
);
CREATE INDEX IF NOT EXISTS expense_categories_code_idx ON expense_categories (code);   -- orderBy('code')

-- customerCategories / customerAllergies ------------------------------
CREATE TABLE IF NOT EXISTS customer_categories (
  id   TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  code TEXT GENERATED ALWAYS AS (data->>'code') STORED
);
CREATE TABLE IF NOT EXISTS customer_allergies (
  id   TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  code TEXT GENERATED ALWAYS AS (data->>'code') STORED
);

-- staff / assets ------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff  ( id TEXT PRIMARY KEY, data JSONB NOT NULL );
CREATE TABLE IF NOT EXISTS assets ( id TEXT PRIMARY KEY, data JSONB NOT NULL );

-- top_customers -------------------------------------------------------
CREATE TABLE IF NOT EXISTS top_customers (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL,
  month        TEXT GENERATED ALWAYS AS (data->>'month') STORED,
  customer_id  TEXT GENERATED ALWAYS AS (data->>'customerId') STORED
);
CREATE INDEX IF NOT EXISTS top_customers_month_idx ON top_customers (month);
CREATE INDEX IF NOT EXISTS top_customers_customer_id_idx ON top_customers (customer_id);

-- customer_followups --------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_followups ( id TEXT PRIMARY KEY, data JSONB NOT NULL );

-- gallery -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gallery (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  created_at  TEXT GENERATED ALWAYS AS (NULLIF(data->>'createdAt','')) STORED
);
CREATE INDEX IF NOT EXISTS gallery_created_at_idx ON gallery (created_at DESC);

-- delivery_assignments ------------------------------------------------
CREATE TABLE IF NOT EXISTS delivery_assignments (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  short_code  TEXT        GENERATED ALWAYS AS (data->>'shortCode') STORED,
  status      TEXT        GENERATED ALWAYS AS (data->>'status') STORED,
  created_at  TEXT GENERATED ALWAYS AS (NULLIF(data->>'createdAt','')) STORED
);
CREATE UNIQUE INDEX IF NOT EXISTS delivery_assignments_short_code_idx ON delivery_assignments (short_code);
CREATE INDEX IF NOT EXISTS delivery_assignments_status_idx ON delivery_assignments (status);
CREATE INDEX IF NOT EXISTS delivery_assignments_created_at_idx ON delivery_assignments (created_at DESC);

-- product_reviews -----------------------------------------------------
CREATE TABLE IF NOT EXISTS product_reviews (
  id           TEXT PRIMARY KEY,
  data         JSONB NOT NULL,
  product_id   TEXT GENERATED ALWAYS AS (data->>'productId') STORED,
  customer_id  TEXT GENERATED ALWAYS AS (data->>'customerId') STORED,
  order_id     TEXT GENERATED ALWAYS AS (data->>'orderId') STORED
);
CREATE INDEX IF NOT EXISTS product_reviews_product_id_idx ON product_reviews (product_id);
CREATE INDEX IF NOT EXISTS product_reviews_dedupe_idx
  ON product_reviews (customer_id, product_id, order_id);

-- audit collections ---------------------------------------------------
CREATE TABLE IF NOT EXISTS orders_audit  ( id TEXT PRIMARY KEY, data JSONB NOT NULL );
CREATE TABLE IF NOT EXISTS product_audit ( id TEXT PRIMARY KEY, data JSONB NOT NULL );

-- ---------------------------------------------------------------------
-- RAG — replaces the `rag_embeddings` collection (JS cosine over 200 docs)
-- with pgvector. all-MiniLM-L6-v2 → 384 dimensions.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rag_embeddings (
  id         TEXT PRIMARY KEY,
  content    TEXT,
  source     TEXT,
  source_id  TEXT,
  meta       JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding  vector(384)                          -- NULL until computed (matches current on-demand behavior)
);
-- Approximate-NN index; build after data + embeddings are loaded:
--   CREATE INDEX rag_embeddings_vec_idx ON rag_embeddings
--     USING hnsw (embedding vector_cosine_ops);

-- rag_rate_limits (per-uid hourly counter) ----------------------------
CREATE TABLE IF NOT EXISTS rag_rate_limits (
  uid          TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count        INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------
-- Dynamic configuration (parameters + system codes).
-- Backing store for values that must not be hardcoded: passcodes,
-- thresholds, default actor name, payment provider selection, etc.
-- Populated at cutover from functions.config() (see manual checklist).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_parameters (
  parameter_key   TEXT PRIMARY KEY,
  parameter_value TEXT,
  parameter_type  TEXT NOT NULL DEFAULT 'string',   -- string | number | boolean | json
  description     TEXT,
  category        TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
