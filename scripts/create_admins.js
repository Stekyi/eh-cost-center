#!/usr/bin/env node
/**
 * Create admin users using Firebase Admin SDK.
 *
 * Usage:
 * 1. Create a service account key JSON in the Firebase Console and save it locally.
 * 2. Set `GOOGLE_APPLICATION_CREDENTIALS` to the key path and optionally set `FIREBASE_PROJECT_ID`.
 * 3. Run: `node scripts/create_admins.js`
 */

const admin = require('firebase-admin')

const projectId = process.env.FIREBASE_PROJECT_ID || ''

try {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: projectId || undefined,
  })
} catch (e) {
  console.error('Failed to initialize firebase-admin. Make sure GOOGLE_APPLICATION_CREDENTIALS is set.')
  console.error(e)
  process.exit(1)
}

console.log('Initialized firebase-admin. projectId=', admin.app().options.projectId)
console.log('Apps count:', admin.apps.length)

const defaultPassword = process.env.ADMIN_PASSWORD || '123456'
const users = [
  { email: 'samueltekyi@gmail.com', password: defaultPassword },
  { email: 'inshiraadomako@gmail.com', password: defaultPassword }
]

async function main() {
  for (const u of users) {
    try {
      // skip if user exists
      let existing = null
      try { existing = await admin.auth().getUserByEmail(u.email) } catch (e) { existing = null }
      if (existing) {
        console.log(`User already exists: ${u.email} (uid=${existing.uid})`)
        // ensure admin claim
        await admin.auth().setCustomUserClaims(existing.uid, { admin: true })
        console.log(`Set admin claim for ${u.email}`)
        continue
      }

      const created = await admin.auth().createUser({
        email: u.email,
        password: u.password,
        emailVerified: false,
        disabled: false,
      })
      console.log(`Created user ${u.email} (uid=${created.uid})`)
      await admin.auth().setCustomUserClaims(created.uid, { admin: true })
      console.log(`Set admin claim for ${u.email}`)
    } catch (err) {
      console.error(`Failed for ${u.email}:`, err.message || err)
    }
  }
  process.exit(0)
}

main()
