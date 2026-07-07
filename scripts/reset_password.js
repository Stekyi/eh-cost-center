#!/usr/bin/env node
/**
 * Reset (or create) a Firebase Auth user password using Admin SDK.
 *
 * Usage:
 *   $env:GOOGLE_APPLICATION_CREDENTIALS="C:\eh-cost-center\sa-key.json"
 *   node scripts/reset_password.js samueltekyi@gmail.com NewPassword123
 */
const admin = require('firebase-admin')

const email = process.argv[2]
const password = process.argv[3]

if (!email || !password) {
  console.error('Usage: node scripts/reset_password.js <email> <new_password>')
  process.exit(1)
}

try {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'eh-cost-center' })
} catch (e) {
  console.error('Failed to init firebase-admin. Set GOOGLE_APPLICATION_CREDENTIALS to your service account key path.')
  console.error(e.message || e)
  process.exit(1)
}

async function main() {
  let user = null
  try {
    user = await admin.auth().getUserByEmail(email)
    console.log(`Found existing user: ${email} (uid=${user.uid})`)
  } catch (e) {
    console.log(`User not found — creating: ${email}`)
  }

  if (user) {
    await admin.auth().updateUser(user.uid, { password })
    console.log(`✅ Password updated for ${email}`)
    await admin.auth().setCustomUserClaims(user.uid, { admin: true })
    console.log(`✅ Admin claim confirmed for ${email}`)
  } else {
    const created = await admin.auth().createUser({ email, password, emailVerified: false })
    console.log(`✅ Created user ${email} (uid=${created.uid})`)
    await admin.auth().setCustomUserClaims(created.uid, { admin: true })
    console.log(`✅ Admin claim set for ${email}`)
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message || e); process.exit(1) })
