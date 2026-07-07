/**
 * Firestore triggers for product reviews and scheduled jobs.
 */
import * as functions from 'firebase-functions'
import * as admin from 'firebase-admin'

const db = admin.firestore()

/**
 * Recalculate avgRating and reviewCount on the product doc
 * when a review is created or updated.
 */
async function recalcProductRating(productId: string) {
  try {
    const reviewsSnap = await db.collection('product_reviews')
      .where('productId', '==', productId)
      .get()

    if (reviewsSnap.empty) {
      await db.collection('products').doc(productId).update({
        avgRating: 0,
        reviewCount: 0,
      })
      return
    }

    let total = 0
    let count = 0
    reviewsSnap.forEach((doc) => {
      const data = doc.data()
      if (typeof data.rating === 'number') {
        total += data.rating
        count++
      }
    })

    const avgRating = count > 0 ? Math.round((total / count) * 10) / 10 : 0

    await db.collection('products').doc(productId).update({
      avgRating,
      reviewCount: count,
    })
  } catch (err) {
    console.error('recalcProductRating error', err)
  }
}

export const onReviewCreate = functions.firestore
  .document('product_reviews/{reviewId}')
  .onCreate(async (snap) => {
    const data = snap.data()
    if (data?.productId) {
      await recalcProductRating(data.productId)
    }
  })

export const onReviewUpdate = functions.firestore
  .document('product_reviews/{reviewId}')
  .onUpdate(async (change) => {
    const after = change.after.data()
    if (after?.productId) {
      await recalcProductRating(after.productId)
    }
  })

export const onReviewDelete = functions.firestore
  .document('product_reviews/{reviewId}')
  .onDelete(async (snap) => {
    const data = snap.data()
    if (data?.productId) {
      await recalcProductRating(data.productId)
    }
  })

/**
 * Scheduled function: runs daily at midnight UTC.
 * Updates weeklyOrderCount on each product — counts how many orders
 * in the last 7 days contain that product.
 */
export const updateWeeklyOrderCounts = functions.pubsub
  .schedule('every 24 hours')
  .onRun(async () => {
    try {
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      // Fetch all orders from the last 7 days
      const ordersSnap = await db.collection('orders')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(sevenDaysAgo))
        .get()

      // Count per product
      const productCounts: Record<string, number> = {}
      ordersSnap.forEach((doc) => {
        const data = doc.data()
        const productIds: string[] = data.productIds || []
        for (const pid of productIds) {
          productCounts[pid] = (productCounts[pid] || 0) + 1
        }
      })

      // Update all products
      const productsSnap = await db.collection('products').get()
      const batch = db.batch()
      productsSnap.forEach((doc) => {
        batch.update(doc.ref, {
          weeklyOrderCount: productCounts[doc.id] || 0,
        })
      })
      await batch.commit()

      console.log(`Updated weeklyOrderCount for ${productsSnap.size} products`)
    } catch (err) {
      console.error('updateWeeklyOrderCounts error', err)
    }
    return null
  })

/**
 * Payment webhook endpoint handler.
 * Called by the payment aggregator when a payment status changes.
 */
export const paymentWebhookHandler = async (req: any, res: any) => {
  try {
    const { getPaymentProvider } = await import('./paymentProvider')
    const provider = getPaymentProvider()

    const event = provider.handleWebhook(req.body, req.headers['x-signature'] || '')

    if (event.status === 'success') {
      // Find order by payment reference
      const ordersSnap = await db.collection('orders')
        .where('paymentTransactionId', '==', event.transactionId)
        .limit(1)
        .get()

      if (ordersSnap.empty) {
        console.warn('Webhook: no order found for transactionId', event.transactionId)
        return res.status(200).json({ ok: true, message: 'no_matching_order' })
      }

      const orderDoc = ordersSnap.docs[0]
      const order = orderDoc.data()

      if (order.paid) {
        return res.status(200).json({ ok: true, message: 'already_paid' })
      }

      const amount = Number(order.orderTotal || order.total || event.amount)
      const paidAt = admin.firestore.FieldValue.serverTimestamp()

      await db.runTransaction(async (t) => {
        t.update(orderDoc.ref, {
          paid: true,
          status: 'paid',
          amountPaid: amount,
          balance: 0,
          paidAt,
          paymentStatus: 'success',
          modifiedAt: paidAt,
        })

        const paymentRef = orderDoc.ref.collection('payments').doc()
        t.set(paymentRef, {
          amount,
          deliveryFee: 0,
          valueDate: new Date().toISOString(),
          recordedAt: paidAt,
          recordedBy: 'payment_webhook',
          network: event.network,
          provider: provider.name,
          transactionId: event.transactionId,
        })

        const revenueRef = db.collection('revenue').doc()
        t.set(revenueRef, {
          orderId: orderDoc.id,
          customerId: order.customerId || null,
          amount,
          deliveryFee: 0,
          type: 'order_payment',
          source: 'payment_webhook',
          network: event.network,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      })
    }

    return res.status(200).json({ ok: true })
  } catch (err: any) {
    console.error('paymentWebhook error', err)
    return res.status(500).json({ error: err.message || 'webhook_failed' })
  }
}
