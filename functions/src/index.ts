import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import express from 'express'
import bcrypt from 'bcryptjs'

admin.initializeApp()
const app = express()
app.use(express.json())

// ── Global CORS — handle preflight for all routes ──────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  next()
})

// ── Customer-facing routes (Flutter app) ──
import customerRoutes from './customerRoutes'
app.use('/customer', customerRoutes)

// ── Payment webhook (no auth required — validated by provider) ──
import { paymentWebhookHandler } from './reviewTriggers'
app.post('/payments/callback', paymentWebhookHandler)

// Simple auth endpoint: compares username/password to functions config and returns success.
app.post('/auth/login', async (req, res) => {
  const cfg = functions.config().auth || {}
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ error: 'missing' })
  const cfgUser = cfg.username
  const hash = cfg.password_hash
  if (!cfgUser || !hash) return res.status(500).json({ error: 'auth config missing' })
  if (username !== cfgUser) return res.status(401).json({ error: 'invalid' })
  const match = await bcrypt.compare(password, hash)
  if (!match) return res.status(401).json({ error: 'invalid' })

  // Issue a custom token for client to sign in with Firebase Auth
  const uid = `admin:${cfgUser}`
  try {
    await admin.auth().getUser(uid).catch(async (err) => {
      if (err.code === 'auth/user-not-found') {
        await admin.auth().createUser({ uid, displayName: cfgUser })
      } else {
        throw err
      }
    })
    const token = await admin.auth().createCustomToken(uid, { role: 'admin' })
    return res.json({ token })
  } catch (err: any) {
    console.error('token error', err)
    return res.status(500).json({ error: 'auth_failed' })
  }
})

// Mark order paid with reconciliation and revenue entry
app.post('/orders/:orderId/markPaid', async (req, res) => {
  const orderId = req.params.orderId
  const { amountPaid, deliveryFee = 0, valueDate } = req.body || {}
  if (!orderId || typeof amountPaid !== 'number') return res.status(400).json({ error: 'missing' })
  if (amountPaid <= 0) return res.status(400).json({ error: 'amount must be > 0' })
  const db = admin.firestore()
  const orderRef = db.collection('orders').doc(orderId)
  try {
    await db.runTransaction(async t => {
      const snap = await t.get(orderRef)
      if (!snap.exists) throw new Error('Order not found')
      const order = snap.data() || {}
      const items: any[] = order.items || []
      if (!Array.isArray(items) || !items.length) throw new Error('Order has no items')

      // fetch products to compute total
      const productIds = items.map(i => i.productId).filter(Boolean)
      const prodsSnap = await db.getAll(...productIds.map(id => db.collection('products').doc(id)))
      const priceMap: Record<string, { unitCost: number; unitsPerPackage: number }> = {}
      prodsSnap.forEach((ps, idx) => {
        if (ps.exists) {
          const pid = productIds[idx]
          const d: any = ps.data()
          priceMap[pid] = { unitCost: Number(d.unitCost || 0), unitsPerPackage: Number(d.unitsPerPackage || 1) }
        }
      })
      const orderTotal = items.reduce((sum, it) => {
        const p = priceMap[it.productId] || { unitCost: 0, unitsPerPackage: 1 }
        return sum + (Number(it.qtyPackages || 0) * p.unitsPerPackage * p.unitCost)
      }, 0)

      const fee = Number(deliveryFee || 0)
      const net = orderTotal + fee - amountPaid
      if (Math.abs(net) > 0.0001) throw new Error('Amount, delivery fee, and order total must balance to zero')

      const paidAt = valueDate ? Timestamp.fromDate(new Date(valueDate)) : FieldValue.serverTimestamp()

      // fetch customer telephone
      let customerTel = ''
      if (order.customerId) {
        const custSnap = await t.get(db.collection('customers').doc(order.customerId))
        if (custSnap.exists) {
          const c = custSnap.data() as any
          customerTel = c.telephone || c.phone || ''
        }
      }

      t.update(orderRef, {
        paid: true,
        amountPaid,
        deliveryFee: fee,
        paidAt,
        total: orderTotal,
      })

      const paymentsRef = orderRef.collection('payments').doc()
      t.set(paymentsRef, {
        amount: amountPaid,
        deliveryFee: fee,
        recordedAt: paidAt,
      })

      const revenueRef = db.collection('revenue').doc()
      t.set(revenueRef, {
        orderId,
        orderNumber: orderId,
        customerTel,
        amountPaid,
        deliveryFee: fee,
        valueDate: paidAt,
        type: 'order_payment',
        createdAt: FieldValue.serverTimestamp(),
      })
    })
    res.json({ ok: true })
  } catch (err: any) {
    console.error('markPaid error', err)
    res.status(400).json({ error: err.message })
  }
})

// Edit order (items, amountPaid, deliveryFee) with server-side validation and audit
app.post('/orders/:orderId/edit', async (req, res) => {
  const orderId = req.params.orderId
  const tokenHeader = req.header('Authorization') || ''
  const token = tokenHeader.startsWith('Bearer ') ? tokenHeader.split('Bearer ')[1] : null
  if (!token) return res.status(401).json({ error: 'missing_token' })

  let decoded: any
  try {
    decoded = await admin.auth().verifyIdToken(token)
  } catch (err: any) {
    console.error('token verify err', err)
    return res.status(401).json({ error: 'invalid_token' })
  }

  const uid = decoded.uid
  const isAdmin = !!decoded.admin || decoded.role === 'admin' || (!!decoded.role && String(decoded.role).toLowerCase() === 'admin')

  const { items: newItems, amountPaid: newAmountPaid, deliveryFee: newDeliveryFee, adminOverrideReason } = req.body || {}
  if (!orderId) return res.status(400).json({ error: 'missing_orderId' })

  const db = admin.firestore()
  const orderRef = db.collection('orders').doc(orderId)

  try {
    const auditId = await db.runTransaction(async (t) => {
      const snap = await t.get(orderRef)
      if (!snap.exists) throw new Error('Order not found')
      const order = snap.data() || {}

      const itemsToUse: any[] = Array.isArray(newItems) ? newItems : (order.items || [])
      if (!Array.isArray(itemsToUse) || itemsToUse.length === 0) throw new Error('missing_items')

      // fetch products
      const productIds = [...new Set(itemsToUse.map((i: any) => i.productId).filter(Boolean))]
      const prodDocs = productIds.length ? await db.getAll(...productIds.map((id) => db.collection('products').doc(id))) : []
      const priceMap: Record<string, any> = {}
      prodDocs.forEach((ps, idx) => {
        if (ps.exists) {
          const pid = productIds[idx]
          const d: any = ps.data()
          priceMap[pid] = d
        }
      })

      const orderTotal = itemsToUse.reduce((sum: number, it: any) => {
        const p = priceMap[it.productId] || {}
        const unitCost = Number(p.unitCost ?? p.price ?? 0)
        const unitsPerPackage = Number(p.unitsPerPackage ?? p.unitsPerPackage ?? 1)
        const qty = Number(it.qtyPackages ?? it.qty ?? 0)
        return sum + qty * unitsPerPackage * unitCost
      }, 0)

      const amt = typeof newAmountPaid === 'number' ? Number(newAmountPaid) : Number(order.amountPaid || 0)
      const fee = typeof newDeliveryFee === 'number' ? Number(newDeliveryFee) : Number(order.deliveryFee || 0)

      // If payment fields provided, enforce equality
      if (typeof newAmountPaid === 'number' || typeof newDeliveryFee === 'number') {
        if (Math.abs(amt - fee - orderTotal) > 1e-6) throw new Error('payment_mismatch')
      }

      // Build updates and record changed keys
      const updates: any = {}
      const changes: any = {}
      if (Array.isArray(newItems)) {
        updates.items = newItems
        changes.items = { before: order.items || null, after: newItems }
      }
      if (typeof newAmountPaid === 'number') {
        updates.amountPaid = amt
        changes.amountPaid = { before: order.amountPaid ?? null, after: amt }
      }
      if (typeof newDeliveryFee === 'number') {
        updates.deliveryFee = fee
        changes.deliveryFee = { before: order.deliveryFee ?? null, after: fee }
      }

      updates.total = orderTotal
      updates.modifiedAt = FieldValue.serverTimestamp()
      updates.modifiedBy = uid

      t.update(orderRef, updates)

      // Write audit doc
      const auditRef = db.collection('orders_audit').doc()
      const auditDoc: any = {
        orderId,
        actorUid: uid,
        isAdmin,
        changes,
        total: orderTotal,
        adminOverrideReason: adminOverrideReason || null,
        createdAt: FieldValue.serverTimestamp(),
      }
      t.set(auditRef, auditDoc)

      return auditRef.id
    })

    res.json({ ok: true, orderId, auditId })
  } catch (err: any) {
    console.error('editOrder error', err)
    const msg = err.message || String(err)
    if (msg === 'missing_items') return res.status(400).json({ error: msg })
    if (msg === 'payment_mismatch') return res.status(400).json({ error: msg })
    return res.status(400).json({ error: msg })
  }
})

app.post('/orders/:orderId/delete', async (req, res) => {
  const orderId = req.params.orderId
  const { passcode } = req.body || {}
  if (!orderId) return res.status(400).json({ error: 'missing_orderId' })

  const tokenHeader = req.header('Authorization') || ''
  const token = tokenHeader.startsWith('Bearer ') ? tokenHeader.split('Bearer ')[1] : null
  if (!token) return res.status(401).json({ error: 'missing_token' })

  let decoded: any
  try {
    decoded = await admin.auth().verifyIdToken(token)
  } catch (err: any) {
    console.error('token verify err', err)
    return res.status(401).json({ error: 'invalid_token' })
  }

  const db = admin.firestore()
  const orderRef = db.collection('orders').doc(orderId)

  try {
    const orderSnap = await orderRef.get()
    if (!orderSnap.exists) return res.status(404).json({ error: 'order_not_found' })
    const orderData = orderSnap.data() || {}

    // Keep passcode protection for paid transactions.
    if (orderData.paid) {
      const requiredPasscode = (functions.config().security && functions.config().security.order_delete_passcode) || '2018'
      if (String(passcode || '') !== String(requiredPasscode)) {
        return res.status(403).json({ error: 'invalid_passcode' })
      }
    }

    const paymentsSnap = await orderRef.collection('payments').get()
    const revSnap = await db.collection('revenue').where('orderId', '==', orderId).get()

    const batch = db.batch()
    paymentsSnap.forEach((d) => batch.delete(d.ref))
    revSnap.forEach((d) => batch.delete(d.ref))
    batch.delete(orderRef)

    const auditRef = db.collection('orders_audit').doc()
    batch.set(auditRef, {
      orderId,
      actorUid: decoded.uid,
      isAdmin: !!decoded.admin || decoded.role === 'admin' || (!!decoded.role && String(decoded.role).toLowerCase() === 'admin'),
      action: 'delete',
      paid: !!orderData.paid,
      amountPaid: Number(orderData.amountPaid || 0),
      deliveryFee: Number(orderData.deliveryFee || 0),
      createdAt: FieldValue.serverTimestamp(),
    })

    await batch.commit()
    return res.json({ ok: true, orderId })
  } catch (err: any) {
    console.error('deleteOrder error', err)
    return res.status(400).json({ error: err?.message || 'delete_failed' })
  }
})

// ── Helper: verify admin token ──────────────────────────────────
async function verifyAdmin(req: any): Promise<{ uid: string } | null> {
  const tokenHeader = req.header('Authorization') || ''
  const token = tokenHeader.startsWith('Bearer ') ? tokenHeader.split('Bearer ')[1] : null
  if (!token) return null
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    const isAdmin = !!decoded.admin || decoded.role === 'admin' || String(decoded.role || '').toLowerCase() === 'admin'
    if (!isAdmin) return null
    return { uid: decoded.uid }
  } catch {
    return null
  }
}

// ── Helper: generate unique short code ──────────────────────────
async function generateShortCode(db: FirebaseFirestore.Firestore): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase()
    const snap = await db.collection('delivery_assignments').where('shortCode', '==', code).limit(1).get()
    if (snap.empty) return code
  }
  throw new Error('Could not generate unique short code')
}

// ── POST /delivery-assignments (admin auth required) ────────────
app.post('/delivery-assignments', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const admin_user = await verifyAdmin(req)
  if (!admin_user) return res.status(401).json({ error: 'unauthorized' })

  const { orderIds, deliveryCompanyName, notes } = req.body || {}
  if (!Array.isArray(orderIds) || orderIds.length === 0)
    return res.status(400).json({ error: 'orderIds array required' })
  if (!deliveryCompanyName)
    return res.status(400).json({ error: 'deliveryCompanyName required' })

  const db = admin.firestore()
  try {
    // Guard: reject if any order is already in a non-completed assignment
    const activeSnap = await db.collection('delivery_assignments')
      .where('status', 'in', ['pending', 'in_progress', 'all_reported'])
      .get()
    const takenIds: string[] = []
    activeSnap.forEach((d) => {
      ;(d.data().orderIds || []).forEach((oid: string) => {
        if (orderIds.includes(oid)) takenIds.push(oid)
      })
    })
    if (takenIds.length > 0)
      return res.status(409).json({ error: 'orders_already_assigned', orderIds: takenIds })

    // Build items array — ONLY safe fields, no cost data
    const items: any[] = []
    for (const orderId of orderIds) {
      const orderSnap = await db.collection('orders').doc(orderId).get()
      if (!orderSnap.exists) continue
      const order = orderSnap.data() as any

      // Fetch customer
      let customerName = order.customerId || ''
      let customerPhone = ''
      let deliveryAddress = order.deliveryAddress || ''
      try {
        const custSnap = await db.collection('customers').doc(order.customerId).get()
        if (custSnap.exists) {
          const c = custSnap.data() as any
          customerName = c.name || customerName
          customerPhone = [c.telephone1, c.telephone2].filter(Boolean).join(' / ')
          deliveryAddress = deliveryAddress || [c.deliveryAddress1, c.city].filter(Boolean).join(', ')
        }
      } catch {}

      // Fetch product names only
      const products: Array<{ productName: string; quantity: number }> = []
      for (const it of order.items || []) {
        let productName = it.productId
        try {
          const pSnap = await db.collection('products').doc(it.productId).get()
          if (pSnap.exists) productName = (pSnap.data() as any).name || it.productId
        } catch {}
        products.push({ productName, quantity: Number(it.qtyPackages ?? it.qty ?? 0) })
      }

      items.push({
        orderId,
        customerName,
        customerPhone,
        deliveryAddress,
        products,
        deliveryStatus: 'pending',
        deliveredAt: null,
      })
    }

    const shortCode = await generateShortCode(db)
    const ref = db.collection('delivery_assignments').doc()
    await ref.set({
      shortCode,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: admin_user.uid,
      status: 'pending',
      orderIds,
      deliveryCompanyName,
      notes: notes || null,
      items,
    })

    return res.json({ ok: true, assignmentId: ref.id, shortCode })
  } catch (err: any) {
    console.error('createDeliveryAssignment error', err)
    return res.status(500).json({ error: err?.message || 'failed' })
  }
})

// ── GET /delivery/:shortCode (NO auth — public) ─────────────────
app.get('/delivery/:shortCode', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  const { shortCode } = req.params
  const db = admin.firestore()
  try {
    const snap = await db.collection('delivery_assignments').where('shortCode', '==', shortCode).limit(1).get()
    if (snap.empty) return res.status(404).json({ error: 'not_found' })
    const docData = snap.docs[0].data() as any
    const assignmentId = snap.docs[0].id
    // Return only safe fields — never orderIds, createdBy, or any cost
    return res.json({
      assignmentId,
      shortCode: docData.shortCode,
      status: docData.status,
      deliveryCompanyName: docData.deliveryCompanyName,
      createdAt: docData.createdAt,
      notes: docData.notes,
      items: (docData.items || []).map((it: any) => ({
        orderId: it.orderId,
        customerName: it.customerName,
        customerPhone: it.customerPhone,
        deliveryAddress: it.deliveryAddress,
        products: it.products,
        deliveryStatus: it.deliveryStatus,
        deliveredAt: it.deliveredAt,
      })),
    })
  } catch (err: any) {
    console.error('getDelivery error', err)
    return res.status(500).json({ error: err?.message || 'failed' })
  }
})

// ── OPTIONS preflight for delivery endpoints ─────────────────────
app.options('/delivery/:shortCode', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.sendStatus(204)
})
app.options('/delivery/:shortCode/items/:orderId', (_req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.sendStatus(204)
})

// ── PUT /delivery/:shortCode/items/:orderId (shortCode = credential) ──
app.put('/delivery/:shortCode/items/:orderId', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const { shortCode, orderId } = req.params
  const { deliveryStatus, deliveredAt } = req.body || {}
  if (!['delivered', 'failed'].includes(deliveryStatus))
    return res.status(400).json({ error: 'deliveryStatus must be delivered or failed' })

  const db = admin.firestore()
  try {
    const snap = await db.collection('delivery_assignments').where('shortCode', '==', shortCode).limit(1).get()
    if (snap.empty) return res.status(404).json({ error: 'not_found' })
    const docRef = snap.docs[0].ref
    const docData = snap.docs[0].data() as any

    if (docData.status === 'completed')
      return res.status(409).json({ error: 'assignment_completed' })

    const items: any[] = docData.items || []
    const idx = items.findIndex((it: any) => it.orderId === orderId)
    if (idx === -1) return res.status(404).json({ error: 'item_not_found' })

    items[idx] = {
      ...items[idx],
      deliveryStatus,
      deliveredAt: deliveredAt || new Date().toISOString(),
    }

    // Recalculate assignment status
    // 'pending' → 'in_progress' as soon as any item is updated
    // 'all_reported' when every item has been marked delivered or failed (ready for admin to reconcile)
    // 'completed' is set only by the reconcile endpoint (admin action)
    const allReported = items.every((it: any) => it.deliveryStatus === 'delivered' || it.deliveryStatus === 'failed')
    const anyUpdated = items.some((it: any) => it.deliveryStatus !== 'pending')
    const newStatus = allReported ? 'all_reported' : anyUpdated ? 'in_progress' : 'pending'

    await docRef.update({ items, status: newStatus })
    return res.json({ ok: true })
  } catch (err: any) {
    console.error('updateDeliveryItem error', err)
    return res.status(500).json({ error: err?.message || 'failed' })
  }
})

// ── POST /delivery-assignments/:id/reconcile (admin auth) ────────
app.post('/delivery-assignments/:assignmentId/reconcile', async (req, res) => {
  const admin_user = await verifyAdmin(req)
  if (!admin_user) return res.status(401).json({ error: 'unauthorized' })

  const { assignmentId } = req.params
  const db = admin.firestore()
  try {
    const assignRef = db.collection('delivery_assignments').doc(assignmentId)
    const assignSnap = await assignRef.get()
    if (!assignSnap.exists) return res.status(404).json({ error: 'not_found' })
    const assignment = assignSnap.data() as any

    const items: any[] = assignment.items || []
    const toDeliver = items.filter((it: any) => it.deliveryStatus === 'delivered')
    if (toDeliver.length === 0) return res.status(400).json({ error: 'no_delivered_items' })

    const batch = db.batch()
    const now = FieldValue.serverTimestamp()

    for (const it of toDeliver) {
      const orderRef = db.collection('orders').doc(it.orderId)
      batch.update(orderRef, {
        delivered: true,
        status: 'delivered',
        deliveredAt: it.deliveredAt || now,
        deliveredBy: assignment.deliveryCompanyName || 'External Delivery',
        modifiedAt: now,
        modifiedBy: admin_user.uid,
      })
    }

    const allResolved = items.every((it: any) => it.deliveryStatus === 'delivered' || it.deliveryStatus === 'failed')
    batch.update(assignRef, {
      status: allResolved ? 'completed' : 'in_progress',
      reconciledAt: now,
      reconciledBy: admin_user.uid,
    })

    await batch.commit()
    return res.json({ ok: true, reconciledCount: toDeliver.length })
  } catch (err: any) {
    console.error('reconcile error', err)
    return res.status(500).json({ error: err?.message || 'failed' })
  }
})

// ── DELETE /delivery-assignments/:id/items/:orderId (admin) ─────
// Removes a single pending order from an active assignment (unassign).
app.delete('/delivery-assignments/:assignmentId/items/:orderId', async (req, res) => {
  const admin_user = await verifyAdmin(req)
  if (!admin_user) return res.status(401).json({ error: 'unauthorized' })

  const { assignmentId, orderId } = req.params
  const db = admin.firestore()
  try {
    const assignRef = db.collection('delivery_assignments').doc(assignmentId)
    const assignSnap = await assignRef.get()
    if (!assignSnap.exists) return res.status(404).json({ error: 'not_found' })

    const assignment = assignSnap.data() as any
    if (assignment.status === 'completed')
      return res.status(409).json({ error: 'assignment_completed' })

    const targetItem = (assignment.items || []).find((it: any) => it.orderId === orderId)
    if (!targetItem) return res.status(404).json({ error: 'item_not_found' })
    if (targetItem.deliveryStatus !== 'pending')
      return res.status(409).json({ error: 'item_already_actioned' })

    const newItems = (assignment.items || []).filter((it: any) => it.orderId !== orderId)
    const newOrderIds = (assignment.orderIds || []).filter((id: string) => id !== orderId)

    if (newItems.length === 0) {
      await assignRef.delete()
      return res.json({ ok: true, deleted: true })
    }

    const allReported = newItems.every((it: any) => it.deliveryStatus === 'delivered' || it.deliveryStatus === 'failed')
    const anyUpdated = newItems.some((it: any) => it.deliveryStatus !== 'pending')
    const newStatus = allReported ? 'all_reported' : anyUpdated ? 'in_progress' : 'pending'

    await assignRef.update({ items: newItems, orderIds: newOrderIds, status: newStatus })
    return res.json({ ok: true, deleted: false })
  } catch (err: any) {
    console.error('removeAssignmentItem error', err)
    return res.status(500).json({ error: err?.message || 'failed' })
  }
})

export const api = functions.https.onRequest(app)

// Firestore triggers to enforce audit fields
const CFG = functions.config().auth || { username: 'Angela' }

export const onDocCreateSetAudit = functions.firestore.document('{col}/{docId}').onCreate(async (snap, ctx) => {
  try{
    const ref = snap.ref
    const data = snap.data() || {}
    const updates: any = {}
    if(!data.createdAt) updates.createdAt = FieldValue.serverTimestamp()
    if(!data.createdBy) updates.createdBy = CFG.username || 'Angela'
    if(Object.keys(updates).length) await ref.update(updates)
  }catch(e){ console.error('audit onCreate err', e) }
})

export const onDocUpdateSetModified = functions.firestore.document('{col}/{docId}').onUpdate(async (change, ctx) => {
  try{
    const beforeData = change.before.data() || {}
    const afterData = change.after.data() || {}

    const auditKeys = new Set(['createdAt', 'createdBy', 'modifiedAt', 'modifiedBy', 'updatedBy'])
    const changedKeys = new Set<string>()
    for (const key of new Set([...Object.keys(beforeData), ...Object.keys(afterData)])) {
      if (beforeData[key] !== afterData[key]) changedKeys.add(key)
    }

    // Avoid infinite loops: if this update only changed audit fields, do nothing.
    const nonAuditChanged = [...changedKeys].some(k => !auditKeys.has(k))
    if (!nonAuditChanged) return

    await change.after.ref.update({
      modifiedAt: FieldValue.serverTimestamp(),
      modifiedBy: CFG.username || 'Angela',
      updatedBy: CFG.username || 'Angela',
    })
  }catch(e){ console.error('audit onUpdate err', e) }
})

// Expense triggers (archive + immutable audit entries)
import './expenseTriggers'

// Review triggers (avgRating recalculation) + scheduled jobs
export { onReviewCreate, onReviewUpdate, onReviewDelete, updateWeeklyOrderCounts } from './reviewTriggers'
