#!/usr/bin/env node
// Insert exported Firebase Auth users into the Neon `users` table.
// Passwords are NOT migrated (Firebase scrypt is not portable): password_hash
// is left NULL and a one-time reset_token is issued so each user can set a new
// password at/after cutover. Firebase custom claims → `role` + `custom_claims`.
//
//   NEON_DATABASE_URL=postgres://... node scripts/migrate/migrate-users.js
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Client } = require('pg')

const USERS = path.join(__dirname, '..', '..', 'migration-data', 'users.json')
const RESET_WINDOW_DAYS = 30

function roleFromClaims(claims = {}) {
  if (claims.admin === true || claims.role === 'admin') return 'admin'
  if (claims.role === 'videographer') return 'videographer'
  if (claims.role === 'assistant') return 'assistant'
  return null // customers have no staff role
}

async function main() {
  if (!process.env.NEON_DATABASE_URL) throw new Error('NEON_DATABASE_URL is required')
  if (!fs.existsSync(USERS)) throw new Error('run export-users.js first (users.json missing)')
  const users = JSON.parse(fs.readFileSync(USERS, 'utf8'))
  const client = new Client({ connectionString: process.env.NEON_DATABASE_URL })
  await client.connect()

  const expires = new Date(Date.now() + RESET_WINDOW_DAYS * 864e5).toISOString()
  const tokens = [] // {email, uid, reset_token} for the reset-email step

  try {
    for (const u of users) {
      const role = roleFromClaims(u.customClaims)
      const token = crypto.randomBytes(24).toString('hex')
      await client.query(
        `INSERT INTO users (uid, email, password_hash, role, custom_claims, display_name, disabled, reset_token, reset_expires)
         VALUES ($1,$2,NULL,$3,$4::jsonb,$5,$6,$7,$8::timestamptz)
         ON CONFLICT (uid) DO UPDATE SET
           email=EXCLUDED.email, role=EXCLUDED.role, custom_claims=EXCLUDED.custom_claims,
           display_name=EXCLUDED.display_name, disabled=EXCLUDED.disabled`,
        [u.uid, u.email, role, JSON.stringify(u.customClaims || {}), u.displayName, u.disabled, token, expires]
      )
      if (u.email) tokens.push({ email: u.email, uid: u.uid, reset_token: token })
    }

    // Emit tokens so send-reset-emails.js can dispatch links without touching the DB again.
    const out = path.join(path.dirname(USERS), 'reset-tokens.json')
    fs.writeFileSync(out, JSON.stringify(tokens, null, 2))
    console.log(`Imported ${users.length} users. Reset tokens for ${tokens.length} emailable users → ${out}`)
    console.log('Next: configure an email sender and run scripts/migrate/send-reset-emails.js')
  } finally {
    await client.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
