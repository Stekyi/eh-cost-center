#!/usr/bin/env node
const admin = require('firebase-admin')

const emails = process.argv.slice(2)

if (!emails.length) {
  console.error('Usage: node scripts/set_videographer_claims.js <email> [more-emails...]')
  process.exit(1)
}

try {
  admin.initializeApp({ credential: admin.credential.applicationDefault() })
} catch (e) {
  console.error('Failed to initialize firebase-admin:', e.message || e)
  process.exit(1)
}

async function main() {
  for (const email of emails) {
    try {
      const user = await admin.auth().getUserByEmail(email)
      console.log('Found user', email, 'uid=', user.uid)
      await admin.auth().setCustomUserClaims(user.uid, { role: 'videographer' })
      const refreshed = await admin.auth().getUser(user.uid)
      console.log('Assigned videographer role to', email)
      console.log('Custom claims now:', refreshed.customClaims)
    } catch (err) {
      console.error('Error for', email, ':', err && err.message ? err.message : err)
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err)
  process.exit(1)
})