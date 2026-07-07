#!/usr/bin/env node
// Verify row-count parity between Firestore and Neon after import.
// Exits non-zero if any collection's counts differ, so it can gate cutover in CI.
//
//   NEON_DATABASE_URL=... node scripts/migrate/verify-parity.js
const { Client } = require('pg')
const { initAdmin } = require('./firebaseAdmin')
const { COLLECTIONS, SUBCOLLECTIONS } = require('./collections')

async function main() {
  const admin = initAdmin()
  const fdb = admin.firestore()
  const pg = new Client({ connectionString: process.env.NEON_DATABASE_URL })
  await pg.connect()

  let mismatches = 0
  const check = async (label, table, fsCount) => {
    const { rows } = await pg.query(`SELECT count(*)::int AS n FROM ${table}`)
    const neon = rows[0].n
    const ok = neon === fsCount
    if (!ok) mismatches++
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(24)} firestore=${fsCount}  neon=${neon}`)
  }

  try {
    for (const { collection, table } of COLLECTIONS) {
      const snap = await fdb.collection(collection).count().get()
      await check(collection, table, snap.data().count)
    }
    for (const spec of SUBCOLLECTIONS) {
      // count subcollection docs across all parents
      const parents = await fdb.collection(spec.parent).get()
      let total = 0
      for (const p of parents.docs) {
        const c = await p.ref.collection(spec.sub).count().get()
        total += c.data().count
      }
      await check(`${spec.parent}/*/${spec.sub}`, spec.table, total)
    }
    console.log(mismatches ? `\n${mismatches} mismatch(es) — DO NOT cut over.` : '\nParity OK.')
    process.exit(mismatches ? 1 : 0)
  } finally {
    await pg.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
