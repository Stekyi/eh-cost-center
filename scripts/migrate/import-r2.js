#!/usr/bin/env node
// Upload downloaded Storage objects to Cloudflare R2 (S3 API), preserving keys,
// then rewrite the URLs persisted in Neon so the app serves media from R2:
//   products/{id}/image → products.data.imageUrl
//   products/{id}/audio → products.data.audioUrl
//   gallery/...         → gallery.data.url  (matched via gallery.data.storageRef)
//
// Env: R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET R2_PUBLIC_BASE NEON_DATABASE_URL
//   node scripts/migrate/import-r2.js
const fs = require('fs')
const path = require('path')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { Client } = require('pg')

const STORAGE_DIR = path.join(__dirname, '..', '..', 'migration-data', 'storage')

function r2() {
  const acct = requireEnv('R2_ACCOUNT_ID')
  return new S3Client({
    region: 'auto',
    endpoint: `https://${acct}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    },
  })
}
function requireEnv(k) { if (!process.env[k]) throw new Error(`${k} is required`); return process.env[k] }

async function main() {
  const manifestPath = path.join(STORAGE_DIR, 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error('run export-storage.js first (manifest.json missing)')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

  const bucket = requireEnv('R2_BUCKET')
  const base = requireEnv('R2_PUBLIC_BASE').replace(/\/$/, '')
  const s3 = r2()
  const db = new Client({ connectionString: requireEnv('NEON_DATABASE_URL') })
  await db.connect()

  try {
    for (const obj of manifest) {
      const body = fs.readFileSync(path.join(STORAGE_DIR, obj.key))
      await s3.send(new PutObjectCommand({
        Bucket: bucket, Key: obj.key, Body: body, ContentType: obj.contentType,
      }))
      const newUrl = `${base}/${obj.key}`
      await rewriteUrl(db, obj.key, newUrl)
      console.log(`  ↑ ${obj.key}`)
    }
    console.log(`\nUploaded ${manifest.length} objects to R2 and rewrote Neon URLs.`)
  } finally {
    await db.end()
  }
}

async function rewriteUrl(db, key, newUrl) {
  let m
  if ((m = key.match(/^products\/([^/]+)\/image$/))) {
    await db.query(`UPDATE products SET data = jsonb_set(data, '{imageUrl}', to_jsonb($2::text)) WHERE id=$1`, [m[1], newUrl])
  } else if ((m = key.match(/^products\/([^/]+)\/audio$/))) {
    await db.query(`UPDATE products SET data = jsonb_set(data, '{audioUrl}', to_jsonb($2::text)) WHERE id=$1`, [m[1], newUrl])
  } else if (key.startsWith('gallery/')) {
    // gallery docs store the object path in data.storageRef
    await db.query(`UPDATE gallery SET data = jsonb_set(data, '{url}', to_jsonb($2::text)) WHERE data->>'storageRef' = $1`, [key, newUrl])
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
