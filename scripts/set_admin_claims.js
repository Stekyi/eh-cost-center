#!/usr/bin/env node
const admin = require('firebase-admin')

try {
  admin.initializeApp({ credential: admin.credential.applicationDefault() })
} catch (e) {
  console.error('Failed to initialize firebase-admin:', e.message || e)
  process.exit(1)
}

const emails = ['samueltekyi@gmail.com', 'inshiraadomako@gmail.com']

async function main() {
  for (const email of emails) {
    try {
      const user = await admin.auth().getUserByEmail(email)
      console.log('Found user', email, 'uid=', user.uid)
      await admin.auth().setCustomUserClaims(user.uid, { admin: true })
      console.log('Set admin claim for', email)
      const refreshed = await admin.auth().getUser(user.uid)
      console.log('Custom claims now:', refreshed.customClaims)
    } catch (err) {
      console.error('Error for', email, ':', err && err.message ? err.message : err)
    }
  }
}

main().then(()=>process.exit(0)).catch(e=>{ console.error(e); process.exit(1) })
