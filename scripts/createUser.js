// One-time script: create Firebase Auth user + set custom role claim
const admin = require('firebase-admin')
const path = require('path')

const CREDS_PATH = path.join(
  process.env.APPDATA || process.env.HOME,
  'AppData/Local/firebase/samueltekyi_gmail_com_application_default_credentials.json',
)

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: 'eh-cost-center',
})

;(async () => {
  const email = 'passt@eh.com'
  const password = '12345678'
  const role = 'assistant'

  let uid
  try {
    const existing = await admin.auth().getUserByEmail(email)
    uid = existing.uid
    console.log('User already exists, updating…')
    await admin.auth().updateUser(uid, { password, emailVerified: true })
  } catch (e) {
    if (e.code === 'auth/user-not-found') {
      const record = await admin.auth().createUser({ email, password, displayName: 'Personal Assistant', emailVerified: true })
      uid = record.uid
      console.log('User created:', uid)
    } else {
      throw e
    }
  }

  await admin.auth().setCustomUserClaims(uid, { role })
  console.log(`✓ Custom claim set: role=${role} for ${email} (uid: ${uid})`)
  process.exit(0)
})().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
