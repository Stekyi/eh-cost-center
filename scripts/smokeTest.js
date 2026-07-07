/**
 * Simple smoke test that creates a customer, product and order via Firestore emulator
 * and attempts to call the markPaid cloud function endpoint when emulators are running.
 * Usage: Start emulators then run `npm run smoke`.
 */
const admin = require('firebase-admin')
const fetchFn = global.fetch
if (!fetchFn) {
  throw new Error('Global fetch is not available. Use Node 18+ or add a fetch polyfill.')
}

if (!process.env.FIRESTORE_EMULATOR_HOST) console.warn('FIRESTORE_EMULATOR_HOST not set — ensure emulator is running')
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'eh-cost-center-local'
admin.initializeApp({ projectId })
const db = admin.firestore()

async function run(){
  console.log('Running smoke test...')
  const cRef = await db.collection('customers').add({ name: 'Smoke User', createdAt: admin.firestore.FieldValue.serverTimestamp() })
  const unitCost = 123
  const unitsPerPackage = 1
  const qtyPackages = 2
  const pRef = await db.collection('products').add({ name: 'Smoke Product', type: 'meal', unitsPerPackage, unitCost, createdAt: admin.firestore.FieldValue.serverTimestamp() })
  const oRef = await db.collection('orders').add({ customerId: cRef.id, items: [{ productId: pRef.id, qtyPackages }], productIds: [pRef.id], status: 'booked', paid: false, amountPaid: 0, createdAt: admin.firestore.FieldValue.serverTimestamp() })
  console.log('Created order', oRef.id)

  // attempt to call functions emulator markPaid endpoint
  const project = projectId
  const functionsHost = process.env.FUNCTIONS_EMULATOR_ORIGIN || 'http://localhost:5001'
  const url = `${functionsHost}/${project}/us-central1/api/orders/${oRef.id}/markPaid`
  console.log('Calling markPaid at', url)
  try{
    const amountPaid = qtyPackages * unitsPerPackage * unitCost
    const res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amountPaid }) })
    const j = await res.text()
    console.log('markPaid response', res.status, j)
  }catch(err){
    console.warn('Could not call function endpoint — is the Functions emulator running?', err.message)
  }

  console.log('Smoke test done')
}

run().catch(err=>{ console.error(err); process.exit(1) })
