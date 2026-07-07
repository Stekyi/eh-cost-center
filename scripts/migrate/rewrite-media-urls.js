#!/usr/bin/env node
// Rewrite media URLs in Neon to the R2 public base, from the storage manifest.
// Used after objects are uploaded to R2 (via `wrangler r2 object put`), so no
// S3 credentials are needed — only NEON_DATABASE_URL + R2_PUBLIC_BASE.
//   products/{id}/image → products.data.imageUrl
//   products/{id}/audio → products.data.audioUrl
//   gallery/...         → gallery.data.url  (matched via gallery.data.storageRef)
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

async function main() {
  const base = (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '')
  if (!process.env.NEON_DATABASE_URL || !base) throw new Error('NEON_DATABASE_URL and R2_PUBLIC_BASE required')
  const manifestPath = path.join(__dirname, '..', '..', 'migration-data', 'storage', 'manifest.json')
  if (!fs.existsSync(manifestPath)) { console.log('no storage manifest; nothing to rewrite'); return }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const db = new Client({ connectionString: process.env.NEON_DATABASE_URL })
  await db.connect()
  let n = 0
  try {
    for (const obj of manifest) {
      const url = `${base}/${obj.key}`
      let m
      if ((m = obj.key.match(/^products\/([^/]+)\/image$/))) {
        await db.query(`UPDATE products SET data = jsonb_set(data,'{imageUrl}',to_jsonb($2::text)) WHERE id=$1`, [m[1], url]); n++
      } else if ((m = obj.key.match(/^products\/([^/]+)\/audio$/))) {
        await db.query(`UPDATE products SET data = jsonb_set(data,'{audioUrl}',to_jsonb($2::text)) WHERE id=$1`, [m[1], url]); n++
      } else if (obj.key.startsWith('gallery/')) {
        await db.query(`UPDATE gallery SET data = jsonb_set(data,'{url}',to_jsonb($2::text)) WHERE data->>'storageRef'=$1`, [obj.key, url]); n++
      }
    }
    console.log(`Rewrote ${n} media URLs to ${base}`)
  } finally { await db.end() }
}
main().catch((e) => { console.error(e.message); process.exit(1) })
