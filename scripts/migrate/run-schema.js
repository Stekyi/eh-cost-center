#!/usr/bin/env node
// Apply db/schema.sql to Neon. Idempotent (CREATE ... IF NOT EXISTS), so it is
// safe to re-run. Reads NEON_DATABASE_URL from the environment.
//   NEON_DATABASE_URL=postgres://... node scripts/migrate/run-schema.js
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

async function main() {
  const url = process.env.NEON_DATABASE_URL
  if (!url) throw new Error('NEON_DATABASE_URL is required')
  const schema = fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'schema.sql'), 'utf8')
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(schema) // multi-statement simple query
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`)
    console.log('Schema applied. Tables now in public schema:')
    for (const r of rows) console.log('  •', r.table_name)
  } finally {
    await client.end()
  }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
