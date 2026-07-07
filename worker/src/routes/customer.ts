// Customer-facing routes for the Flutter app (were functions/src/customerRoutes.ts).
// The request/response CONTRACT is preserved; only the datastore (Neon) and the
// auth token (our JWT instead of a Firebase ID token) change. The Flutter app
// must switch to the new /api/auth/login token — see the manual checklist.
import { sql, transaction, type Env } from '../db'
import { json } from '../collections'
import { verifyJwt, type Claims } from '../auth'
const now = () => new Date().toISOString()

async function requireCustomer(req: Request, env: Env): Promise<Claims | null> {
  const h = req.headers.get('Authorization') || ''
  return h.startsWith('Bearer ') ? verifyJwt(env, h.slice(7)) : null
}

// Sandbox mobile-money provider (ported from paymentProvider.ts). Replace with a
// real Paystack/Hubtel/Korba adapter before taking live payments.
const provider = {
  async initializePayment(o: { amount: number; phone: string; network: string }) {
    return { transactionId: `sandbox_${crypto.randomUUID()}`, status: 'pending', network: o.network }
  },
  async verifyPayment(_txnId: string) { return { status: 'success' as const } },
}

export async function handleCustomer(req: Request, env: Env, parts: string[]): Promise<Response> {
  // parts = ['customer', ...rest]
  const rest = parts.slice(1)
  const claims = await requireCustomer(req, env)
  if (!claims) return json({ error: 'unauthorized' }, 401)
  const uid = claims.uid
  const q = sql(env)

  // POST /customer/orders
  if (req.method === 'POST' && rest[0] === 'orders' && rest.length === 1) {
    const body = await req.json().catch(() => ({} as any))
    const items: any[] = body.items || []
    if (!items.length) return json({ error: 'items required' }, 400)
    const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))]
    const prods = await q(`SELECT id, data FROM products WHERE id = ANY($1)`, [productIds])
    const priceMap: Record<string, any> = {}
    for (const p of prods) priceMap[p.id] = p.data
    const orderTotal = items.reduce((s, it) => {
      const p = priceMap[it.productId] || {}
      // unit price × qty (unitsPerPackage is metadata, not a multiplier)
      return s + Number(it.qtyPackages ?? it.qty ?? 0) * Number(p.unitCost ?? p.price ?? 0)
    }, 0)
    const id = crypto.randomUUID()
    const data = { customerId: uid, items, status: 'booked', source: 'customer_app',
      orderTotal, total: orderTotal, balance: orderTotal, paid: false, delivered: false, createdAt: now() }
    await q(`INSERT INTO orders (id, data) VALUES ($1,$2::jsonb)`, [id, JSON.stringify(data)])
    return json({ id, ...data }, 201)
  }

  // POST /customer/orders/:id/pay
  if (req.method === 'POST' && rest[0] === 'orders' && rest[2] === 'pay') {
    const orderId = rest[1]
    const { phoneNumber, network } = await req.json().catch(() => ({} as any))
    if (!phoneNumber || !['mtn', 'telecel', 'airteltigo'].includes(network)) return json({ error: 'phone_and_network_required' }, 400)
    const [o] = await q(`SELECT data FROM orders WHERE id = $1`, [orderId])
    if (!o || o.data.customerId !== uid) return json({ error: 'not_found' }, 404)
    if (o.data.paid) return json({ error: 'already_paid' }, 409)
    const init = await provider.initializePayment({ amount: Number(o.data.total || 0), phone: phoneNumber, network })
    const updated = { ...o.data, paymentTransactionId: init.transactionId, paymentNetwork: network,
      paymentPhone: phoneNumber, paymentProvider: 'sandbox', paymentStatus: init.status }
    await q(`UPDATE orders SET data = $2::jsonb WHERE id = $1`, [orderId, JSON.stringify(updated)])
    return json({ ok: true, transactionId: init.transactionId, status: init.status })
  }

  // GET /customer/orders/:id/payment-status
  if (req.method === 'GET' && rest[0] === 'orders' && rest[2] === 'payment-status') {
    const orderId = rest[1]
    const [o] = await q(`SELECT data FROM orders WHERE id = $1`, [orderId])
    if (!o || o.data.customerId !== uid) return json({ error: 'not_found' }, 404)
    if (o.data.paid) return json({ status: 'success', paid: true })
    const v = await provider.verifyPayment(o.data.paymentTransactionId)
    if (v.status !== 'success') return json({ status: v.status, paid: false })
    await transaction(env, async (tq) => {
      const amount = Number(o.data.total || 0)
      await tq(`UPDATE orders SET data = $2::jsonb WHERE id = $1`, [orderId,
        JSON.stringify({ ...o.data, paid: true, status: 'paid', amountPaid: amount, balance: 0, paidAt: now() })])
      await tq(`INSERT INTO order_payments (id, order_id, data) VALUES ($1,$2,$3::jsonb)`,
        [crypto.randomUUID(), orderId, JSON.stringify({ amount, recordedAt: now(), recordedBy: 'customer_app' })])
      await tq(`INSERT INTO revenue (id, data) VALUES ($1,$2::jsonb)`,
        [crypto.randomUUID(), JSON.stringify({ orderId, amountPaid: amount, type: 'order_payment', source: 'customer_app', createdAt: now() })])
    })
    return json({ status: 'success', paid: true })
  }

  // POST /customer/profile
  if (req.method === 'POST' && rest[0] === 'profile') {
    const body = await req.json().catch(() => ({} as any))
    const [existing] = await q(`SELECT data FROM customers WHERE id = $1`, [uid])
    const data = { ...(existing?.data || {}), ...body, modifiedAt: now() }
    if (!existing) data.createdAt = now()
    await q(`INSERT INTO customers (id, data) VALUES ($1,$2::jsonb)
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [uid, JSON.stringify(data)])
    return json({ id: uid, ...data })
  }

  // POST /customer/reviews
  if (req.method === 'POST' && rest[0] === 'reviews') {
    const { productId, orderId, rating, comment } = await req.json().catch(() => ({} as any))
    if (!productId || !orderId || !(rating >= 1 && rating <= 5)) return json({ error: 'invalid_input' }, 400)
    const [o] = await q(`SELECT data FROM orders WHERE id = $1`, [orderId])
    if (!o || o.data.customerId !== uid || !o.data.delivered) return json({ error: 'not_eligible' }, 403)
    const [dupe] = await q(`SELECT id FROM product_reviews WHERE customer_id=$1 AND product_id=$2 AND order_id=$3`, [uid, productId, orderId])
    const id = dupe?.id || crypto.randomUUID()
    const data = { customerId: uid, productId, orderId, rating, comment: comment || '', modifiedAt: now(), createdAt: now() }
    await q(`INSERT INTO product_reviews (id, data) VALUES ($1,$2::jsonb)
             ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [id, JSON.stringify(data)])
    // recompute product rating (trigger replacement)
    const { recalcProductRating } = await import('../hooks')
    await recalcProductRating(env, productId)
    return json({ id, ...data })
  }

  // POST /customer/fcm-token
  if (req.method === 'POST' && rest[0] === 'fcm-token') {
    const { fcmToken } = await req.json().catch(() => ({} as any))
    await q(`UPDATE customers SET data = jsonb_set(jsonb_set(data,'{fcmToken}',to_jsonb($2::text)),'{fcmTokenUpdatedAt}',to_jsonb($3::text)) WHERE id = $1`,
      [uid, fcmToken || '', now()])
    return json({ ok: true })
  }

  return json({ error: 'not_found' }, 404)
}
