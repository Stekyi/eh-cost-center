#!/usr/bin/env node
/**
 * Seed test data: customer, product, order, expense; then run mark-paid transaction
 * and print JSON of affected documents.
 * Requires GOOGLE_APPLICATION_CREDENTIALS to be set.
 */

const admin = require('firebase-admin')

try {
  admin.initializeApp({ credential: admin.credential.applicationDefault() })
} catch (e) {
  console.error('Failed to init admin:', e.message || e)
  process.exit(1)
}

const db = admin.firestore()

async function seed() {
  // create customer
  const custRef = db.collection('customers').doc()
  const customer = {
    name: 'Test Customer',
    phone: '+233501234567',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'seed-script'
  }
  await custRef.set(customer)

  // create product
  const prodRef = db.collection('products').doc()
  const product = {
    name: 'Test Product',
    price: 25.5,
    unitCost: 20,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'seed-script'
  }
  await prodRef.set(product)
  console.log('Created product:', prodRef.path)

  // create order
  const orderRef = db.collection('orders').doc()
  const order = {
    customerId: custRef.id,
    items: [ { productId: prodRef.id, qty: 2 } ],
    paid: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'seed-script'
  }
  await orderRef.set(order)
  console.log('Created order:', orderRef.path)

  // create expense item
  const expRef = db.collection('expenseItems').doc()
  const expense = {
    description: 'Test expense',
    amount: 15.0,
    costType: 'variable',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'seed-script'
  }
  await expRef.set(expense)

  // seed expense categories
  const categories = [
    { code: 'EXP001', label: 'Ingredients' },
    { code: 'EXP002', label: 'Packaging' },
    { code: 'EXP003', label: 'Labour' },
    { code: 'EXP004', label: 'Logistics / Transport' },
    { code: 'EXP005', label: 'Utilities (Gas, Water, Electricity)' },
    { code: 'EXP006', label: 'Equipment / Repairs' },
    { code: 'EXP007', label: 'Marketing' },
    { code: 'EXP008', label: 'Miscellaneous' },
  ]
  for(const c of categories) await db.collection('expenseCategories').add({ ...c, createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: 'seed-script' })

  return { custRef, prodRef, orderRef, expRef }
}

async function markPaid(orderRef) {
  const orderSnap = await orderRef.get()
  if (!orderSnap.exists) throw new Error('Order not found')
  const order = orderSnap.data()

  // compute total
  let total = 0
  for (const it of order.items || []) {
    const pSnap = await db.collection('products').doc(it.productId).get()
    if (!pSnap.exists) {
      console.error('Referenced product not found:', it.productId)
      throw new Error('Product not found: ' + it.productId)
    }
    const p = pSnap.data() || {}
    const price = Number(p.price || 0)
    const qty = Number(it.qty || 0)
    total += price * qty
  }

  const amountPaid = total
  const deliveryFee = 0

  await db.runTransaction(async (t) => {
    const snap = await t.get(orderRef)
    if (!snap.exists) throw new Error('Order not found in transaction')
    const now = admin.firestore.FieldValue.serverTimestamp()
    t.update(orderRef, {
      paid: true,
      amountPaid,
      deliveryFee,
      paidAt: now,
      valueDate: admin.firestore.Timestamp.now(),
      modifiedAt: now,
      modifiedBy: 'seed-script'
    })

    const paymentsCol = orderRef.collection('payments')
    const payRef = paymentsCol.doc()
    t.set(payRef, {
      amount: amountPaid,
      deliveryFee,
      recordedAt: now,
      recordedBy: 'seed-script'
    })

    const revenueRef = db.collection('revenue').doc()
    t.set(revenueRef, {
      orderId: orderRef.id,
      customerId: order.customerId || null,
      amount: amountPaid,
      deliveryFee,
      valueDate: admin.firestore.Timestamp.now(),
      createdAt: now,
      createdBy: 'seed-script'
    })
  })
}

async function printJson(refs) {
  const { custRef, prodRef, orderRef, expRef } = refs
  const out = {}
  out.customer = (await custRef.get()).data()
  out.product = (await prodRef.get()).data()
  out.order = (await orderRef.get()).data()
  const paymentsSnap = await orderRef.collection('payments').get()
  out.payments = paymentsSnap.docs.map(d=>({ id: d.id, data: d.data() }))
  const revSnap = await db.collection('revenue').where('orderId','==',orderRef.id).get()
  out.revenue = revSnap.docs.map(d=>({ id: d.id, data: d.data() }))
  out.expense = (await expRef.get()).data()

  console.log(JSON.stringify(out, null, 2))
}

async function main(){
  console.log('Seeding test data...')
  const refs = await seed()
  console.log('Seeded. Running mark-paid...')
  await markPaid(refs.orderRef)
  console.log('Mark-paid done. Fetching JSON...')
  await printJson(refs)
}

main().catch(e=>{ console.error('Error:', e.message || e); process.exit(1) })
