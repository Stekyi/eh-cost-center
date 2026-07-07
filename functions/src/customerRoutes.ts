/**
 * Customer-facing API endpoints for the Flutter app.
 * Mounted under /customer/* in the main Express app.
 */
import { Router } from 'express'
import * as admin from 'firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { getPaymentProvider } from './paymentProvider'

const router = Router()
const db = admin.firestore()

// ── Middleware: verify Firebase ID token ──
async function requireAuth(req: any, res: any, next: any) {
  const tokenHeader = req.header('Authorization') || ''
  const token = tokenHeader.startsWith('Bearer ') ? tokenHeader.split('Bearer ')[1] : null
  if (!token) return res.status(401).json({ error: 'missing_token' })
  try {
    req.user = await admin.auth().verifyIdToken(token)
    next()
  } catch (err: any) {
    console.error('Auth error', err)
    return res.status(401).json({ error: 'invalid_token' })
  }
}

router.use(requireAuth)

// ── POST /customer/orders — Create order from customer app ──
router.post('/orders', async (req: any, res) => {
  const uid = req.user.uid
  const { items, customerInstructions, deliveryAddress } = req.body || {}

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items_required' })
  }

  try {
    // Validate products exist and compute total server-side
    const productIds = [...new Set(items.map((i: any) => i.productId).filter(Boolean))]
    if (productIds.length === 0) return res.status(400).json({ error: 'invalid_items' })

    const prodDocs = await db.getAll(...productIds.map((id: string) => db.collection('products').doc(id)))
    const priceMap: Record<string, { unitCost: number; unitsPerPackage: number; name: string }> = {}
    prodDocs.forEach((ps, idx) => {
      if (ps.exists) {
        const d: any = ps.data()
        priceMap[productIds[idx]] = {
          unitCost: Number(d.unitCost || 0),
          unitsPerPackage: Number(d.unitsPerPackage || 1),
          name: d.name || '',
        }
      }
    })

    // Validate all items reference existing products
    for (const item of items) {
      if (!priceMap[item.productId]) {
        return res.status(400).json({ error: `product_not_found: ${item.productId}` })
      }
      if (!item.qtyPackages || Number(item.qtyPackages) <= 0) {
        return res.status(400).json({ error: `invalid_quantity for ${item.productId}` })
      }
    }

    const orderTotal = items.reduce((sum: number, it: any) => {
      const p = priceMap[it.productId]
      return sum + (Number(it.qtyPackages) * p.unitsPerPackage * p.unitCost)
    }, 0)

    const orderDoc: any = {
      customerId: uid,
      items: items.map((it: any) => ({
        productId: it.productId,
        qtyPackages: Number(it.qtyPackages),
      })),
      productIds,
      status: 'booked',
      paid: false,
      delivered: false,
      amountPaid: 0,
      deliveryFee: 0,
      balance: orderTotal,
      orderTotal,
      total: orderTotal,
      customerInstructions: customerInstructions || '',
      deliveryAddress: deliveryAddress || '',
      createdAt: FieldValue.serverTimestamp(),
      createdBy: uid,
      source: 'customer_app', // Distinguish from internal orders
    }

    const docRef = await db.collection('orders').add(orderDoc)

    return res.json({
      ok: true,
      orderId: docRef.id,
      orderTotal,
    })
  } catch (err: any) {
    console.error('createOrder error', err)
    return res.status(500).json({ error: err.message || 'order_creation_failed' })
  }
})

// ── POST /customer/orders/:orderId/pay — Initiate mobile money payment ──
router.post('/orders/:orderId/pay', async (req: any, res) => {
  const uid = req.user.uid
  const { orderId } = req.params
  const { phoneNumber, network } = req.body || {}

  if (!phoneNumber || !network) {
    return res.status(400).json({ error: 'phoneNumber and network required' })
  }

  const validNetworks = ['mtn', 'telecel', 'airteltigo']
  if (!validNetworks.includes(network)) {
    return res.status(400).json({ error: `invalid network. Must be one of: ${validNetworks.join(', ')}` })
  }

  try {
    const orderRef = db.collection('orders').doc(orderId)
    const orderSnap = await orderRef.get()

    if (!orderSnap.exists) return res.status(404).json({ error: 'order_not_found' })
    const order: any = orderSnap.data()

    // Verify customer owns this order
    if (order.customerId !== uid) {
      return res.status(403).json({ error: 'not_your_order' })
    }

    if (order.paid) {
      return res.status(400).json({ error: 'order_already_paid' })
    }

    const amount = Number(order.orderTotal || order.total || 0)
    if (amount <= 0) {
      return res.status(400).json({ error: 'invalid_order_total' })
    }

    const provider = getPaymentProvider()
    const reference = `order_${orderId}_${Date.now()}`

    const result = await provider.initializePayment({
      amount,
      phoneNumber,
      network: network as any,
      reference,
      description: `Payment for order ${orderId}`,
    })

    // Store payment attempt on order
    await orderRef.update({
      paymentRef: reference,
      paymentTransactionId: result.transactionId,
      paymentNetwork: network,
      paymentPhone: phoneNumber,
      paymentProvider: provider.name,
      paymentStatus: result.status,
      modifiedAt: FieldValue.serverTimestamp(),
    })

    return res.json({
      ok: true,
      transactionId: result.transactionId,
      status: result.status,
      providerRef: result.providerRef,
    })
  } catch (err: any) {
    console.error('payOrder error', err)
    return res.status(500).json({ error: err.message || 'payment_failed' })
  }
})

// ── GET /customer/orders/:orderId/payment-status — Poll payment status ──
router.get('/orders/:orderId/payment-status', async (req: any, res) => {
  const uid = req.user.uid
  const { orderId } = req.params

  try {
    const orderRef = db.collection('orders').doc(orderId)
    const orderSnap = await orderRef.get()

    if (!orderSnap.exists) return res.status(404).json({ error: 'order_not_found' })
    const order: any = orderSnap.data()

    if (order.customerId !== uid) {
      return res.status(403).json({ error: 'not_your_order' })
    }

    if (order.paid) {
      return res.json({ status: 'success', paid: true })
    }

    if (!order.paymentTransactionId) {
      return res.json({ status: 'no_payment_initiated', paid: false })
    }

    // Poll the payment provider
    const provider = getPaymentProvider()
    const result = await provider.verifyPayment(order.paymentTransactionId)

    if (result.status === 'success' && !order.paid) {
      // Payment confirmed — update order
      const amount = Number(order.orderTotal || order.total || 0)
      const paidAt = FieldValue.serverTimestamp()

      await db.runTransaction(async (t) => {
        t.update(orderRef, {
          paid: true,
          status: 'paid',
          amountPaid: amount,
          balance: 0,
          paidAt,
          paymentStatus: 'success',
          modifiedAt: paidAt,
        })

        // Create payment record
        const paymentRef = orderRef.collection('payments').doc()
        t.set(paymentRef, {
          amount,
          deliveryFee: 0,
          valueDate: new Date().toISOString(),
          recordedAt: paidAt,
          recordedBy: uid,
          network: order.paymentNetwork || '',
          phone: order.paymentPhone || '',
          provider: order.paymentProvider || '',
          transactionId: order.paymentTransactionId || '',
        })

        // Create revenue entry
        const revenueRef = db.collection('revenue').doc()
        t.set(revenueRef, {
          orderId,
          customerId: order.customerId,
          amount,
          deliveryFee: 0,
          type: 'order_payment',
          source: 'customer_app',
          network: order.paymentNetwork || '',
          createdAt: FieldValue.serverTimestamp(),
        })
      })

      return res.json({ status: 'success', paid: true })
    }

    return res.json({ status: result.status, paid: false })
  } catch (err: any) {
    console.error('paymentStatus error', err)
    return res.status(500).json({ error: err.message || 'status_check_failed' })
  }
})

// ── POST /customer/profile — Create or update customer profile ──
router.post('/profile', async (req: any, res) => {
  const uid = req.user.uid
  const { name, telephone1, city, deliveryAddress1, deliveryAddress2, dob, categoryCodes, allergyCodes } = req.body || {}

  if (!name) return res.status(400).json({ error: 'name_required' })

  try {
    const customerRef = db.collection('customers').doc(uid)
    const snap = await customerRef.get()

    if (snap.exists) {
      // Update existing profile
      await customerRef.update({
        name,
        telephone1: telephone1 || req.user.phone_number || '',
        city: city || null,
        deliveryAddress1: deliveryAddress1 || null,
        deliveryAddress2: deliveryAddress2 || null,
        dob: dob || null,
        categoryCodes: categoryCodes || [],
        allergyCodes: allergyCodes || [],
        modifiedAt: FieldValue.serverTimestamp(),
        modifiedBy: uid,
      })
    } else {
      // Create new customer profile
      await customerRef.set({
        name,
        telephone1: telephone1 || req.user.phone_number || '',
        telephone2: '',
        city: city || null,
        deliveryAddress1: deliveryAddress1 || null,
        deliveryAddress2: deliveryAddress2 || null,
        dob: dob || null,
        profile: '',
        categoryCodes: categoryCodes || [],
        allergyCodes: allergyCodes || [],
        createdAt: FieldValue.serverTimestamp(),
        createdBy: uid,
        source: 'customer_app',
      })
    }

    return res.json({ ok: true })
  } catch (err: any) {
    console.error('profile error', err)
    return res.status(500).json({ error: err.message || 'profile_update_failed' })
  }
})

// ── POST /customer/reviews — Submit a product review ──
router.post('/reviews', async (req: any, res) => {
  const uid = req.user.uid
  const { productId, orderId, rating, comment } = req.body || {}

  if (!productId || !orderId || typeof rating !== 'number') {
    return res.status(400).json({ error: 'productId, orderId, and rating required' })
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be 1-5' })
  }

  try {
    // Verify customer owns the order and it's delivered
    const orderSnap = await db.collection('orders').doc(orderId).get()
    if (!orderSnap.exists) return res.status(404).json({ error: 'order_not_found' })
    const order: any = orderSnap.data()

    if (order.customerId !== uid) {
      return res.status(403).json({ error: 'not_your_order' })
    }

    if (!order.delivered) {
      return res.status(400).json({ error: 'order_not_delivered_yet' })
    }

    // Check product is in order
    const productInOrder = (order.productIds || []).includes(productId) ||
      (order.items || []).some((it: any) => it.productId === productId)
    if (!productInOrder) {
      return res.status(400).json({ error: 'product_not_in_order' })
    }

    // Check if already reviewed
    const existingReview = await db.collection('product_reviews')
      .where('customerId', '==', uid)
      .where('productId', '==', productId)
      .where('orderId', '==', orderId)
      .limit(1)
      .get()

    if (!existingReview.empty) {
      // Update existing review
      const reviewDoc = existingReview.docs[0]
      await reviewDoc.ref.update({
        rating,
        comment: comment || '',
        modifiedAt: FieldValue.serverTimestamp(),
      })
      return res.json({ ok: true, reviewId: reviewDoc.id, action: 'updated' })
    }

    // Create new review
    const reviewRef = await db.collection('product_reviews').add({
      productId,
      customerId: uid,
      orderId,
      rating,
      comment: comment || '',
      createdAt: FieldValue.serverTimestamp(),
    })

    return res.json({ ok: true, reviewId: reviewRef.id, action: 'created' })
  } catch (err: any) {
    console.error('review error', err)
    return res.status(500).json({ error: err.message || 'review_failed' })
  }
})

// ── POST /customer/fcm-token — Register FCM token for push notifications ──
router.post('/fcm-token', async (req: any, res) => {
  const uid = req.user.uid
  const { token } = req.body || {}

  if (!token) return res.status(400).json({ error: 'token_required' })

  try {
    await db.collection('customers').doc(uid).update({
      fcmToken: token,
      fcmTokenUpdatedAt: FieldValue.serverTimestamp(),
    })
    return res.json({ ok: true })
  } catch (err: any) {
    console.error('fcm-token error', err)
    return res.status(500).json({ error: err.message || 'fcm_token_failed' })
  }
})

export default router
