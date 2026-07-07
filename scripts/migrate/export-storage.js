#!/usr/bin/env node
// Download every Firebase Storage object to migration-data/storage/<objectPath>,
// preserving the key structure (products/{id}/image, gallery/{tempId}/{name}, …).
// A manifest.json records each object's path + contentType for the R2 import.
//
//   node scripts/migrate/export-storage.js
const fs = require('fs')
const path = require('path')
const { initAdmin } = require('./firebaseAdmin')

const OUT_DIR = path.join(__dirname, '..', '..', 'migration-data', 'storage')

async function main() {
  const admin = initAdmin()
  const bucket = admin.storage().bucket()   // uses storageBucket from init
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const [files] = await bucket.getFiles()
  const manifest = []
  console.log(`Downloading ${files.length} objects from ${bucket.name}…`)

  let failed = 0
  for (const file of files) {
    if (file.name.endsWith('/')) continue // skip folder placeholders
    const dest = path.join(OUT_DIR, file.name)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    try {
      await file.download({ destination: dest })
      const contentType = file.metadata.contentType || 'application/octet-stream'
      manifest.push({ key: file.name, contentType, size: Number(file.metadata.size || 0) })
      console.log(`  ${file.name}`)
    } catch (err) {
      failed++
      console.warn(`  ! skip (download failed): ${file.name} — ${err.message?.split('\n')[0] || err}`)
      try { fs.rmSync(dest, { force: true }) } catch {}
    }
  }
  if (failed) console.log(`(${failed} object(s) could not be downloaded — likely dangling references)`)

  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nDone. ${manifest.length} objects + manifest → ${OUT_DIR}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
