#!/usr/bin/env node
/**
 * Create or update Firebase Auth users via the Identity Toolkit REST API.
 * Uses the Web API key (not a service account) — admin SDK not required.
 *
 * Limitations: REST API cannot set custom claims. After running this, run
 * set_admin_claims.js (which needs a service account) OR set claims manually
 * in the Firebase Console (Authentication > Users > select user > Edit > Custom claims).
 *
 * Usage:
 *   node scripts/reset_via_rest.js <WEB_API_KEY>
 */

const https = require('https')

const API_KEY = process.argv[2]
if (!API_KEY) {
  console.error('Usage: node scripts/reset_via_rest.js <VITE_FIREBASE_API_KEY>')
  process.exit(1)
}

const users = [
  { email: 'samueltekyi@gmail.com', password: 'eh2018eh4' },
  { email: 'inshiraadomako@gmail.com', password: 'eh2018eh4' },
]

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }
    const req = https.request(url, options, (res) => {
      let raw = ''
      res.on('data', d => raw += d)
      res.on('end', () => {
        try { resolve(JSON.parse(raw)) } catch { resolve(raw) }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function main() {
  for (const u of users) {
    // Try sign-in first to see if user exists
    console.log(`\nProcessing ${u.email}...`)

    // Attempt to update password by signing in and using update endpoint
    // First try creating the user
    const createRes = await post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`,
      { email: u.email, password: u.password, returnSecureToken: false }
    )

    if (createRes.localId) {
      console.log(`✅ Created user ${u.email} (uid=${createRes.localId})`)
      console.log(`   ⚠️  IMPORTANT: You must manually set admin claim in Firebase Console or run set_admin_claims.js`)
    } else if (createRes.error && createRes.error.message === 'EMAIL_EXISTS') {
      // User exists — update password via sign-in + update
      const signInRes = await post(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
        { email: u.email, password: u.password, returnSecureToken: true }
      )
      if (signInRes.idToken) {
        console.log(`✅ ${u.email} already exists and password is correct — can log in now`)
      } else {
        // Password differs — we can't reset without Admin SDK, need to use OOB
        console.log(`⚠️  ${u.email} exists but password is wrong. Sending password reset email...`)
        const resetRes = await post(
          `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${API_KEY}`,
          { requestType: 'PASSWORD_RESET', email: u.email }
        )
        if (resetRes.email) {
          console.log(`📧 Password reset email sent to ${u.email}`)
        } else {
          console.log(`   Response:`, JSON.stringify(resetRes))
        }
      }
    } else {
      console.log(`   Response:`, JSON.stringify(createRes))
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
