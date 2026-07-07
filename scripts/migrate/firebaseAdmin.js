// Shared Firebase Admin bootstrap for migration scripts.
// Credentials resolution order:
//   1. FIREBASE_SA_KEY   — raw or base64-encoded service-account JSON (good for CI)
//   2. FIREBASE_SA_PATH / GOOGLE_APPLICATION_CREDENTIALS — path to a JSON key file
//   3. application-default credentials
const admin = require('firebase-admin')

function initAdmin() {
  if (admin.apps.length) return admin

  const raw = process.env.FIREBASE_SA_KEY
  const path = process.env.FIREBASE_SA_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS

  let credential
  if (raw) {
    const json = raw.trim().startsWith('{')
      ? raw
      : Buffer.from(raw, 'base64').toString('utf8')
    credential = admin.credential.cert(JSON.parse(json))
  } else if (path) {
    credential = admin.credential.cert(require(path))
  } else {
    credential = admin.credential.applicationDefault()
  }

  admin.initializeApp({
    credential,
    projectId: process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET,
  })
  return admin
}

// Recursively convert Firestore-native types into JSON-safe values so the
// document survives a round-trip with zero loss:
//   Timestamp    → ISO-8601 string
//   GeoPoint     → { _geopoint: { latitude, longitude } }
//   DocumentRef  → { _ref: '<path>' }
//   Bytes/Buffer → { _bytes: '<base64>' }
function serialize(value) {
  if (value === null || value === undefined) return value
  if (value instanceof admin.firestore.Timestamp) return value.toDate().toISOString()
  if (value instanceof admin.firestore.GeoPoint) return { _geopoint: { latitude: value.latitude, longitude: value.longitude } }
  if (value instanceof admin.firestore.DocumentReference) return { _ref: value.path }
  if (Buffer.isBuffer(value)) return { _bytes: value.toString('base64') }
  if (Array.isArray(value)) return value.map(serialize)
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v)
    return out
  }
  return value
}

module.exports = { initAdmin, serialize }
