#!/usr/bin/env node
// Export all Firebase Auth users + custom claims to migration-data/users.json.
// Password hashes (Google scrypt) are intentionally NOT relied upon — they
// cannot be imported into our self-hosted auth. We capture email, uid,
// displayName, disabled, and customClaims (admin/assistant/videographer).
//
//   node scripts/migrate/export-users.js
const fs = require('fs')
const path = require('path')
const { initAdmin } = require('./firebaseAdmin')

const OUT = path.join(__dirname, '..', '..', 'migration-data', 'users.json')

async function main() {
  const admin = initAdmin()
  fs.mkdirSync(path.dirname(OUT), { recursive: true })

  const users = []
  let pageToken
  do {
    const res = await admin.auth().listUsers(1000, pageToken)
    for (const u of res.users) {
      users.push({
        uid: u.uid,
        email: u.email || null,
        displayName: u.displayName || null,
        disabled: !!u.disabled,
        customClaims: u.customClaims || {},
        emailVerified: !!u.emailVerified,
        // metadata only — hashes not used (scrypt not portable)
        createdAt: u.metadata.creationTime || null,
      })
    }
    pageToken = res.pageToken
  } while (pageToken)

  fs.writeFileSync(OUT, JSON.stringify(users, null, 2))
  console.log(`Exported ${users.length} users → ${OUT}`)
  console.log('NOTE: passwords are NOT exported. Users reset at cutover.')
}

main().catch((err) => { console.error(err); process.exit(1) })
