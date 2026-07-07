#!/usr/bin/env node
// Import migration-data/firestore/*.json into Neon. Idempotent: every row is an
// upsert keyed by primary key, so this can be re-run to capture incremental
// Firebase writes right before cutover.
//
//   NEON_DATABASE_URL=postgres://... node scripts/migrate/import-neon.js
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')
const { COLLECTIONS, SUBCOLLECTIONS } = require('./collections')

const DATA_DIR = path.join(__dirname, '..', '..', 'migration-data', 'firestore')
const SPECIAL = new Set(['rag_embeddings', 'rag_rate_limits'])

function load(table) {
  const file = path.join(DATA_DIR, `${table}.json`)
  if (!fs.existsSync(file)) { console.warn(`  ! no export for ${table}, skipping`); return null }
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

// Generic { id, data } upsert.
async function upsertDocs(client, table, rows) {
  for (const r of rows) {
    await client.query(
      `INSERT INTO ${table} (id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [r.id, JSON.stringify(r.data)]
    )
  }
}

// Subcollection upsert with an extra FK column (order_payments.order_id).
async function upsertSub(client, spec, rows) {
  for (const r of rows) {
    await client.query(
      `INSERT INTO ${spec.table} (id, ${spec.fk}, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, ${spec.fk} = EXCLUDED.${spec.fk}`,
      [r.id, r[spec.fk], JSON.stringify(r.data)]
    )
  }
}

async function upsertRagEmbeddings(client, rows) {
  for (const r of rows) {
    const d = r.data || {}
    const emb = Array.isArray(d.embedding) ? `[${d.embedding.join(',')}]` : null
    await client.query(
      `INSERT INTO rag_embeddings (id, content, source, source_id, meta, embedding)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector)
       ON CONFLICT (id) DO UPDATE SET content=EXCLUDED.content, source=EXCLUDED.source,
         source_id=EXCLUDED.source_id, meta=EXCLUDED.meta, embedding=EXCLUDED.embedding`,
      [r.id, d.content || d.text || null, d.source || null, d.sourceId || null,
       JSON.stringify(d.meta || {}), emb]
    )
  }
}

async function upsertRateLimits(client, rows) {
  for (const r of rows) {
    const d = r.data || {}
    await client.query(
      `INSERT INTO rag_rate_limits (uid, window_start, count)
       VALUES ($1, COALESCE($2::timestamptz, now()), $3)
       ON CONFLICT (uid) DO UPDATE SET window_start=EXCLUDED.window_start, count=EXCLUDED.count`,
      [r.id, d.windowStart || null, Number(d.count || 0)]
    )
  }
}

async function main() {
  if (!process.env.NEON_DATABASE_URL) throw new Error('NEON_DATABASE_URL is required')
  const client = new Client({ connectionString: process.env.NEON_DATABASE_URL })
  await client.connect()

  try {
    for (const { collection, table } of COLLECTIONS) {
      const rows = load(table)
      if (!rows) continue
      await client.query('BEGIN')
      if (table === 'rag_embeddings') await upsertRagEmbeddings(client, rows)
      else if (table === 'rag_rate_limits') await upsertRateLimits(client, rows)
      else await upsertDocs(client, table, rows)
      await client.query('COMMIT')
      console.log(`  ${table.padEnd(24)} ${rows.length} rows upserted`)
    }

    for (const spec of SUBCOLLECTIONS) {
      const rows = load(spec.table)
      if (!rows) continue
      await client.query('BEGIN')
      await upsertSub(client, spec, rows)
      await client.query('COMMIT')
      console.log(`  ${spec.table.padEnd(24)} ${rows.length} rows upserted`)
    }
    console.log('\nImport complete.')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
