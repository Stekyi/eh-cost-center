#!/usr/bin/env node
// Export every Firestore collection (+ the orders/{id}/payments subcollection)
// to migration-data/firestore/<table>.json — one array of { id, data } rows.
// Read-only against Firebase; safe to run against production at any time.
//
//   node scripts/migrate/export-firestore.js
const fs = require('fs')
const path = require('path')
const { initAdmin, serialize } = require('./firebaseAdmin')
const { COLLECTIONS, SUBCOLLECTIONS } = require('./collections')

const OUT_DIR = path.join(__dirname, '..', '..', 'migration-data', 'firestore')

async function exportCollection(db, collection, table) {
  const snap = await db.collection(collection).get()
  const rows = snap.docs.map((d) => ({ id: d.id, data: serialize(d.data()) }))
  fs.writeFileSync(path.join(OUT_DIR, `${table}.json`), JSON.stringify(rows, null, 2))
  console.log(`  ${collection.padEnd(24)} → ${table.padEnd(24)} ${rows.length} docs`)
  return snap.docs
}

async function exportSubcollections(db, parentDocs, spec) {
  const rows = []
  for (const parent of parentDocs) {
    const subSnap = await parent.ref.collection(spec.sub).get()
    for (const d of subSnap.docs) {
      rows.push({ id: d.id, [spec.fk]: parent.id, data: serialize(d.data()) })
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, `${spec.table}.json`), JSON.stringify(rows, null, 2))
  console.log(`  ${(spec.parent + '/*/' + spec.sub).padEnd(24)} → ${spec.table.padEnd(24)} ${rows.length} docs`)
}

async function main() {
  const admin = initAdmin()
  const db = admin.firestore()
  fs.mkdirSync(OUT_DIR, { recursive: true })

  console.log('Exporting Firestore collections…')
  const docsByCollection = {}
  for (const { collection, table } of COLLECTIONS) {
    try {
      docsByCollection[collection] = await exportCollection(db, collection, table)
    } catch (err) {
      console.warn(`  ! skipped ${collection}: ${err.message}`)
    }
  }

  for (const spec of SUBCOLLECTIONS) {
    const parents = docsByCollection[spec.parent] || []
    await exportSubcollections(db, parents, spec)
  }

  console.log(`\nDone. Wrote JSON to ${OUT_DIR}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
