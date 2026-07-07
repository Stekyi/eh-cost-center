# EH Cost Center — Firebase → Cloudflare Pages + Neon Postgres Migration

Status: **planning / scaffolding complete**. This document is the source of truth for
the migration. It records the audit, the target architecture, the step-by-step plan,
the rollback plan, and the checklist of manual actions.

---

## 1. Audit — what Firebase services are actually used

| Firebase service | Used? | Where / how |
|---|---|---|
| **Hosting** | ✅ | `firebase.json` → serves `dist/`, rewrites `/api/**` to the `api` function, SPA fallback to `index.html`. (A `vercel.json` also exists — the project was already mid-migration off Firebase Hosting.) |
| **Firestore** | ✅ (heavy) | ~22 collections + the `orders/{id}/payments` subcollection. **16 files use `onSnapshot` real-time listeners.** 1 `runTransaction` (markPaid), `writeBatch` cascade deletes, 1 true composite query (`orders where paid==true && delivered==false`), several single-field ordered/filtered queries. No data-access layer — every page calls the Firestore SDK inline via `db` from `src/utils/firebaseClient.ts`. |
| **Authentication** | ✅ | Client email/password (`signInWithEmailAndPassword`) + `sendPasswordResetEmail`. Roles = **custom claims** (`admin`, `assistant`, `videographer`) set only by Admin-SDK scripts. Server verifies ID tokens (`verifyIdToken`) on privileged routes. A legacy `/auth/login` custom-token endpoint exists but no client calls `signInWithCustomToken` (dead). `signInAnonymously` imported but never called. |
| **Storage** | ✅ | 100% client-side uploads gated by `storage.rules`. Paths: `products/{id}/image`, `products/{id}/audio`, `gallery/{tempId}/{name}`. Download URLs persisted into Firestore (`products.imageUrl`, `products.audioUrl`, `gallery.url`; `gallery.storageRef` keeps the path). No Admin-SDK storage use. |
| **Realtime Database** | ❌ | Not used anywhere. Only Firestore. |
| **Cloud Functions** | ✅ | One Express app (`api`) + Firestore triggers + 1 daily cron. See §1.1. |

### 1.1 Cloud Functions inventory

| Function | Type | What it does | Migration target |
|---|---|---|---|
| `api` (Express) | HTTPS | Admin routes: `/auth/login`, `/orders/:id/markPaid`, `/edit`, `/delete`, `/delivery-assignments*`, public `/delivery/:shortCode*`, `/payments/callback`; mounts `/customer/*`. | Cloudflare Worker (`worker/`) — routes ported 1:1. |
| `onDocCreateSetAudit` / `onDocUpdateSetModified` | Firestore wildcard trigger | Stamp `createdAt/createdBy` / `modifiedAt/modifiedBy` on every doc. | App-level: the Worker's write layer stamps these on every insert/update (see `worker/src/collections.ts`). |
| `onExpenseItemCreate/Update/Delete` | Firestore trigger (`expenseItems`) | Write `expenseItems_audit` rows; archive on delete. | App-level hooks in the Worker's expense write path. |
| `onReviewCreate/Update/Delete` | Firestore trigger (`product_reviews`) | Recompute `products.avgRating` + `reviewCount`. | App-level in the Worker's review write path. |
| `updateWeeklyOrderCount` | pubsub cron (24h) | Tally last-7-days orders per product → `products.weeklyOrderCount`. | Cloudflare **Cron Trigger** (`wrangler.toml` `[triggers] crons`). |
| RAG: `api/rag/query.js`, `api/embed.js` (Vercel) | HTTP | Cosine similarity over `rag_embeddings` docs; HF embeddings; Fireworks/HF generation; per-uid rate limit. | Worker route using **pgvector** `<=>` search + `rag_rate_limits` table. |
| `paymentProvider.ts` + `/payments/callback` | lib + webhook | Sandbox mobile-money provider only; no real integration wired. | Ported as-is; real provider is future work (config-driven). |

### 1.2 Scope & external consumers
- **In scope:** the EH Cost Center **admin web app** and its backend only.
- **OUT of scope:** the **Flutter customer app** is NOT being migrated — it stays on Firebase. The Worker's `/customer/*` routes were ported but are **dormant** (not wired into the admin frontend); keep or delete them as you like.
- Public delivery pages hit `/delivery/:shortCode` (no auth; shortCode is the credential) — part of the admin flow, kept.

> **⚠️ Split-brain risk.** The admin app and the customer app share collections (`orders`, `customers`, `products`, `product_reviews`). If the customer app keeps writing to **Firestore** while the admin app reads/writes **Neon**, the two datastores diverge. Before cutover, confirm one of: (a) the customer app is not live yet (its payment provider is still the sandbox stub, which suggests pre-production); (b) the customer app is retired; or (c) you run a continuous Firestore→Neon sync for the shared collections until the customer app is migrated too. Do not cut the admin app over to Neon while a live customer app is still writing to Firestore.

---

## 2. Target architecture

```
                         ┌───────────────────────────────────────────┐
   Browser (staff SPA)   │  Cloudflare Pages  (static dist/)          │
   Flutter customer app  │  + Pages routing:  /api/*  /customer/*  →  │
                         └───────────────┬───────────────────────────┘
                                         │  (route / service binding)
                                         ▼
                         ┌───────────────────────────────────────────┐
                         │  Cloudflare Worker  (worker/)              │
                         │   • JWT auth (self-hosted, bcrypt)         │
                         │   • generic /api/collections/* REST        │
                         │     (compat layer backend)                 │
                         │   • ported custom routes (orders, delivery)│
                         │   • /customer/* (contract preserved)       │
                         │   • RAG (pgvector), cron (weekly counts)   │
                         └──────┬───────────────────────────┬─────────┘
                                │ @neondatabase/serverless   │ S3 API
                                ▼                            ▼
                     ┌────────────────────┐      ┌────────────────────┐
                     │  Neon Postgres      │      │  Cloudflare R2      │
                     │  (JSONB + pgvector) │      │  (product/gallery   │
                     └────────────────────┘      │   media)            │
                                                  └────────────────────┘
```

**Service mapping**

| Firebase | Target |
|---|---|
| Hosting | Cloudflare Pages (static `dist/`) |
| Firestore | Neon Postgres — one table per collection, full doc in `JSONB`, generated columns for indexed query fields (`db/schema.sql`) |
| `onSnapshot` realtime | Interval polling hook (`useLiveCollection`, default 15s + refetch on window focus) |
| Auth (email/pw + custom claims) | Self-hosted JWT: `users` table (bcrypt), `role` column, JWT signed/verified in the Worker |
| Storage | Cloudflare R2 (S3 API), uploads via Worker-issued presigned URLs |
| Cloud Functions (Express) | Cloudflare Worker |
| Firestore triggers | App-level write hooks in the Worker |
| Cron (`updateWeeklyOrderCount`) | Cloudflare Cron Trigger |
| RAG (Firestore cosine) | pgvector on Neon |
| `functions.config()` secrets | Worker env / secrets + `app_parameters` table (no hardcoding) |

**Why these choices** (decisions confirmed with the owner):
- **Self-hosted JWT** — Firebase scrypt password hashes can't be imported to a non-Firebase system, and we want zero vendor lock-in / per-user cost. Passwords are re-set once at cutover.
- **Interval polling** — this is an internal admin tool; polling is robust on Cloudflare's edge with far less infrastructure than a WebSocket push layer. Contract-preserving.
- **Compat layer + incremental migration** — a thin `dataClient` facade keeps the 40+ page files changing minimally and lets us migrate screen-by-screen while both stacks run, satisfying "keep the app working during transition."

---

## 3. Data model strategy (zero data loss)

- Every document is stored **verbatim** in a `data JSONB` column keyed by its original Firestore id. Nothing is dropped or reshaped during migration — nested arrays (`order.items`, `productIds`, `categoryCodes`), maps, everything survives.
- Query fields are exposed as `GENERATED ALWAYS AS (...) STORED` columns so we get native indexes without a second copy that can drift.
- Firestore `Timestamp` → exported as ISO-8601 string → cast to `timestamptz` in generated columns.
- The `orders/{id}/payments` subcollection becomes `order_payments` with an `order_id` FK (`ON DELETE CASCADE` reproduces the batch-delete behavior).
- Normalization (splitting `data` JSONB into real columns) is deliberately deferred — it can happen table-by-table *after* cutover without another data migration.

---

## 4. Step-by-step migration plan

Each phase is independently revertible. The app stays live on Firebase until Phase 8.

**Phase 0 — Provision (no code impact)**
1. Create a Neon project + database; copy the pooled connection string → `NEON_DATABASE_URL`.
2. Create an R2 bucket (`eh-media`) + an R2 API token; note account id, access key, secret.
3. Create a Cloudflare Pages project pointed at this repo (build `npm run build`, output `dist`).
4. `psql "$NEON_DATABASE_URL" -f db/schema.sql`.

**Phase 1 — Export from Firebase (read-only, safe)**
5. `node scripts/migrate/export-firestore.js` → writes `migration-data/firestore/*.json` (all collections + `order_payments`).
6. `node scripts/migrate/export-storage.js` → downloads all Storage objects to `migration-data/storage/`.
7. `firebase auth:export migration-data/users.json --format=json` (or `node scripts/migrate/export-users.js`) → user records + claims.

**Phase 2 — Import into Neon + R2**
8. `node scripts/migrate/import-neon.js` → loads every JSON file into its table (idempotent upsert).
9. `node scripts/migrate/import-r2.js` → uploads `migration-data/storage/**` to R2, preserving keys; then rewrites `products.imageUrl/audioUrl` and `gallery.url` in Neon to R2 public URLs.
10. `node scripts/migrate/migrate-users.js` → inserts `users` rows (email, role from claims, `password_hash = NULL`, one-time `reset_token`).

**Phase 3 — Deploy the Worker (parallel to Firebase)**
11. Configure `worker/wrangler.toml` bindings + secrets; `cd worker && npm i && npx wrangler deploy`.
12. Smoke-test the Worker directly (health, a collection read, `/customer/*` contract) against Neon — Firebase still serves production.

**Phase 4 — Verify data parity**
13. Run `node scripts/migrate/verify-parity.js` (counts per collection Firestore vs Neon; spot-check documents). Must be 100% before proceeding.

**Phase 5 — Wire the frontend compat layer (behind a flag)**
14. Point `VITE_DATA_BACKEND=neon` and `VITE_API_BASE=<worker url>`; the compat layer (`src/utils/dataClient.ts`) routes reads/writes to the Worker instead of Firestore. Migrate screens in batches; run each against the deployed Worker.

**Phase 6 — Re-verify + dual-run**
15. Keep both stacks live. Any writes during this window are handled by whichever backend the flag selects — run a final incremental re-export/re-import (`import-neon.js` is idempotent) immediately before cutover to capture last-minute Firebase writes.

**Phase 7 — Cutover**
16. Point DNS / Pages to production. Send password-reset emails to all users (`scripts/migrate/send-reset-emails.js`). Enable the Cloudflare Cron Trigger.
17. Put Firestore rules into read-only (`allow write: if false`) to prevent split-brain writes.

**Phase 8 — Decommission (after a safe soak period, e.g. 2 weeks)**
18. Remove Firebase deps, `firebase.json`, `functions/`, Firestore/Storage rules; delete the Firebase project last, after backups are archived.

---

## 5. Rollback plan

Rollback is fast because Firebase is untouched until Phase 7 and remains intact through the soak period.

| If failure occurs in… | Rollback action |
|---|---|
| Phases 0–6 | None needed — production still on Firebase. Delete Neon/R2/Pages resources if abandoning. |
| Phase 5 (compat layer) | Redeploy the previous SPA build (or `git revert` the migrated screens) — reverted screens import `firebaseClient` again and read Firestore. Because migration is per-screen, roll back only the screens that regressed. Keep each screen's migration in its own commit so reverts are surgical. |
| Phase 7 (cutover), within soak | 1) Repoint DNS/Pages back to Firebase Hosting. 2) Restore Firestore rules to writable (`git checkout firestore.rules`). 3) Re-run `scripts/migrate/reverse-sync.js` to copy any Neon-only writes made during the incident back into Firestore. 4) Announce to users; passwords set on Neon do not affect Firebase logins. |
| After decommission | Restore from the archived Firebase export + the last Neon snapshot. This is the only non-trivial rollback — hence the soak period before Phase 8. |

**Guardrails:** keep the raw Firebase export (`migration-data/`) archived off-repo; take a Neon branch/snapshot immediately before each destructive step; never delete the Firebase project until the checklist below is fully green.

---

## 6. Manual-action checklist (things automation can't do for you)

- [ ] Create Neon project; set `NEON_DATABASE_URL` (pooled) locally and as a Pages/Worker secret.
- [ ] Create R2 bucket `eh-media`; enable public access (or a public custom domain) for `products/**` and `gallery/**` — these were publicly readable in `storage.rules`. Set `R2_*` secrets.
- [ ] Create Cloudflare Pages project; set build = `npm run build`, output = `dist`; add env vars `VITE_API_BASE`, `VITE_DATA_BACKEND`.
- [ ] Generate a strong `JWT_SECRET` (32+ bytes) → Worker secret.
- [ ] Migrate `functions.config()` values into secrets / `app_parameters`:
  - [ ] `auth.username` / `auth.password_hash` → seed an initial admin in `users` (bcrypt) or discard (legacy `/auth/login`).
  - [ ] `security.order_delete_passcode` (was hardcoded fallback `'2018'`) → `app_parameters('ORDER_DELETE_PASSCODE')`. **Do not keep the hardcoded default.**
  - [ ] default audit actor name (`'Angela'`) → `app_parameters('DEFAULT_ACTOR')`.
  - [ ] `HUGGINGFACE_API_TOKEN`, `FIREWORKS_API_KEY`, `RAG_ALLOW_ANON` → Worker secrets.
- [ ] Resolve the **split-brain risk** (see §1.2): confirm the customer app is not live / retired, or stand up a Firestore→Neon sync for shared collections before cutover.
- [ ] After data load, build the pgvector index: `CREATE INDEX rag_embeddings_vec_idx ON rag_embeddings USING hnsw (embedding vector_cosine_ops);` and backfill embeddings (`scripts/rag_index_seed.js` port).
- [ ] Send password-reset emails at cutover (users cannot log in until they reset — scrypt hashes were not migrated). Configure an email sender (Resend/SES/etc.); wire `sendPasswordResetEmail` equivalent.
- [ ] Recreate the composite behavior of Firestore security rules as Worker authorization (row-level checks) — the DB has no rules engine. See `worker/src/auth.ts` role guards.
- [ ] Set the Cloudflare Cron Trigger schedule for `updateWeeklyOrderCount`.
- [ ] Update `.github/workflows/*` (currently Firebase Hosting deploy actions) to deploy Pages + Worker.
- [ ] Remove the hardcoded service-account path `C:\secret\...json` from `scripts/initCollections.js` and `scripts/rag_index_seed.js` before running exports; use `GOOGLE_APPLICATION_CREDENTIALS`.

---

## 7. File map of this migration

| Path | Purpose |
|---|---|
| `db/schema.sql` | Neon schema (tables + JSONB + generated columns + indexes + pgvector + users + app_parameters). |
| `scripts/migrate/export-firestore.js` | Export all Firestore collections + subcollections to JSON. |
| `scripts/migrate/export-users.js` | Export Auth users + custom claims. |
| `scripts/migrate/export-storage.js` | Download all Storage objects. |
| `scripts/migrate/import-neon.js` | Load exported JSON into Neon (idempotent upsert). |
| `scripts/migrate/import-r2.js` | Upload media to R2 + rewrite URLs in Neon. |
| `scripts/migrate/migrate-users.js` | Insert `users` rows with reset tokens. |
| `scripts/migrate/verify-parity.js` | Count/spot-check Firestore vs Neon. |
| `worker/` | Cloudflare Worker API (Neon client, JWT auth, collection REST, ported routes, cron, RAG). |
| `src/utils/dataClient.ts` | Frontend compat layer (Firestore-shaped facade over the Worker REST API). |
| `src/hooks/useLiveCollection.ts` | Polling replacement for `onSnapshot`. |
| `wrangler.toml` / `worker/wrangler.toml` | Cloudflare config. |
