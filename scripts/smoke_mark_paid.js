#!/usr/bin/env node
/**
 * Smoke test: find an unpaid order and perform the mark-paid transaction
 * using the Admin SDK (bypasses rules) to verify DB writes (order update,
 * payments subdoc, revenue doc).
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS to be set to a service account key.
 */

const admin = require('firebase-admin')

try {
  admin.initializeApp({ credential: admin.credential.applicationDefault() })
} catch (e) {
  console.error('Failed to init admin:', e.message || e)
  process.exit(1)
}

const db = admin.firestore()

async function findUnpaidOrder() {
  const snap = await db.collection('orders').where('paid', '==', false).limit(1).get()
  if (!snap.empty) return snap.docs[0]
  // fallback: find order without paid field
  const snap2 = await db.collection('orders').where('paid', '==', null).limit(1).get().catch(()=>({ empty: true }))
  if (!snap2.empty) return snap2.docs[0]
  return null
}

async function computeOrderTotal(orderData) {
  const items = orderData.items || []
  let total = 0
  for (const it of items) {
    const pid = it.productId
    const pSnap = await db.collection('products').doc(pid).get()
    if (!pSnap.exists) throw new Error('Product not found: ' + pid)
    const p = pSnap.data() || {}
    const price = Number(p.price || p.unitCost || 0)
    const qty = Number(it.qty || it.qtyPackages || 0)
    total += price * qty
  }
  return total
}

async function run() {
  const doc = await findUnpaidOrder()
  if (!doc) { console.log('No unpaid orders found'); return }
  const orderRef = doc.ref
  const order = doc.data()
  console.log('Found unpaid order:', orderRef.path)
  const orderTotal = await computeOrderTotal(order)
  console.log('Computed order total:', orderTotal)

  // For smoke test, set amountPaid = orderTotal, deliveryFee = 0
  const amountPaid = orderTotal
  const deliveryFee = 0

  await db.runTransaction(async (t) => {
    const snap = await t.get(orderRef)
    if (!snap.exists) throw new Error('Order disappeared')
    const now = admin.firestore.FieldValue.serverTimestamp()
    t.update(orderRef, {
      paid: true,
      amountPaid: amountPaid,
      deliveryFee: deliveryFee,
      paidAt: now,
      valueDate: admin.firestore.Timestamp.now(),
      modifiedAt: now,
      modifiedBy: 'smoke-test'
    })

    const paymentsCol = orderRef.collection('payments')
    const payRef = paymentsCol.doc()
    t.set(payRef, {
      amount: amountPaid,
      deliveryFee,
      recordedAt: now,
      recordedBy: 'smoke-test'
    })

    const revenueRef = db.collection('revenue').doc()
    t.set(revenueRef, {
      orderId: orderRef.id,
      customerId: order.customerId || null,
      amount: amountPaid,
      deliveryFee,
      valueDate: admin.firestore.Timestamp.now(),
      createdAt: now,
      createdBy: 'smoke-test'
    })
  })

  console.log('Transaction committed. Fetching documents...')
  const updated = await orderRef.get()
  console.log('Order now:', updated.data())
  const payments = await orderRef.collection('payments').orderBy('recordedAt','desc').limit(5).get()
  payments.forEach(p=>console.log('Payment:', p.id, p.data()))
  const revSnap = await db.collection('revenue').where('orderId','==',orderRef.id).get()
  revSnap.forEach(r=>console.log('Revenue:', r.id, r.data()))
}

run().catch(e=>{ console.error('Smoke test failed:', e.message || e); process.exit(1) })
