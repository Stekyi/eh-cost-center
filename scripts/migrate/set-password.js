#!/usr/bin/env node
// Set (or reset) a user's password directly in Neon — for bootstrapping the
// first admin before the reset-email flow is wired. Reads the password from an
// env var so it never appears in shell history/args if you use a here-string.
//
//   NEON_DATABASE_URL=... EMAIL=you@example.com NEW_PASSWORD=... \
//     node scripts/migrate/set-password.js
//
// (On PowerShell: $env:EMAIL='you@x.com'; $env:NEW_PASSWORD='...'; node ...)
const bcrypt = require('bcryptjs')
const { Client } = require('pg')

async function main() {
  const { NEON_DATABASE_URL, EMAIL, NEW_PASSWORD } = process.env
  if (!NEON_DATABASE_URL) throw new Error('NEON_DATABASE_URL is required')
  if (!EMAIL || !NEW_PASSWORD) throw new Error('EMAIL and NEW_PASSWORD env vars are required')
  if (NEW_PASSWORD.length < 8) throw new Error('password must be at least 8 characters')

  const hash = await bcrypt.hash(NEW_PASSWORD, 10)
  const c = new Client({ connectionString: NEON_DATABASE_URL })
  await c.connect()
  const r = await c.query(
    `UPDATE users SET password_hash=$2, reset_token=NULL, reset_expires=NULL, updated_at=now()
     WHERE email=$1 RETURNING email, role`, [EMAIL.toLowerCase(), hash])
  await c.end()
  if (!r.rows.length) throw new Error(`no user with email ${EMAIL}`)
  console.log('Password set for', r.rows[0].email, '(role:', r.rows[0].role + ')')
}
main().catch((e) => { console.error(e.message); process.exit(1) })
