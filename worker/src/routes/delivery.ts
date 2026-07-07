// Ported delivery routes (were functions/src/index.ts):
//   POST   /api/delivery-assignments                       (admin)
//   POST   /api/delivery-assignments/:id/reconcile         (admin)
//   DELETE /api/delivery-assignments/:id/items/:orderId    (admin)
//   GET    /delivery/:shortCode                            (public)
//   PUT    /delivery/:shortCode/items/:orderId             (shortCode = credential)
import { sql, transaction, type Env } from '../db'
import { json } from '../collections'
import { getClaims, isAdmin } from '../auth'
const now = () => new Date().toISOString()

async function genShortCode(q: (t: string, p?: any[]) => Promise<any[]>): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase()
    const rows = await q(`SELECT 1 FROM delivery_assignments WHERE short_code = $1 LIMIT 1`, [code])
    if (!rows.length) return code
  }
  throw new Error('Could not generate unique short code')
}

export async function createAssignment(req: Request, env: Env): Promise<Response> {
  const claims = await getClaims(req, env)
  if (!isAdmin(claims)) return json({ error: 'unauthorized' }, 401)
  const { orderIds, deliveryCompanyName, notes } = await req.json().catch(() => ({} as any))
  if (!Array.isArray(orderIds) || !orderIds.length) return json({ error: 'orderIds array required' }, 400)
  if (!deliveryCompanyName) return json({ error: 'deliveryCompanyName required' }, 400)
  const q = sql(env)

  // Guard: reject orders already in a non-completed assignment.
  const active = await q(`SELECT data FROM delivery_assignments WHERE status IN ('pending','in_progress','all_reported')`)
  const taken: string[] = []
  for (const a of active) for (const oid of a.data.orderIds || []) if (orderIds.includes(oid)) taken.push(oid)
  if (taken.length) return json({ error: 'orders_already_assigned', orderIds: taken }, 409)

  const items: any[] = []
  for (const orderId of orderIds) {
    const [o] = await q(`SELECT data FROM orders WHERE id = $1`, [orderId])
    if (!o) continue
    const order = o.data
    let customerName = order.customerId || '', customerPhone = '', deliveryAddress = order.deliveryAddress || ''
    const [c] = order.customerId ? await q(`SELECT data FROM customers WHERE id = $1`, [order.customerId]) : [null]
    if (c) {
      customerName = c.data.name || customerName
      customerPhone = [c.data.telephone1, c.data.telephone2].filter(Boolean).join(' / ')
      deliveryAddress = deliveryAddress || [c.data.deliveryAddress1, c.data.city].filter(Boolean).join(', ')
    }
    const products: any[] = []
    for (const it of order.items || []) {
      let productName = it.productId
      const [p] = await q(`SELECT data FROM products WHERE id = $1`, [it.productId])
      if (p) productName = p.data.name || it.productId
      products.push({ productName, quantity: Number(it.qtyPackages ?? it.qty ?? 0) })
    }
    items.push({ orderId, customerName, customerPhone, deliveryAddress, products, deliveryStatus: 'pending', deliveredAt: null })
  }

  const shortCode = await genShortCode(q)
  const id = crypto.randomUUID()
  await q(`INSERT INTO delivery_assignments (id, data) VALUES ($1,$2::jsonb)`, [id, JSON.stringify({
    shortCode, createdAt: now(), createdBy: claims!.uid, status: 'pending',
    orderIds, deliveryCompanyName, notes: notes || null, items,
  })])
  return json({ ok: true, assignmentId: id, shortCode })
}

export async function getDelivery(env: Env, shortCode: string): Promise<Response> {
  const [row] = await sql(env)(`SELECT id, data FROM delivery_assignments WHERE short_code = $1 LIMIT 1`, [shortCode])
  if (!row) return json({ error: 'not_found' }, 404)
  const d = row.data
  // Return only safe fields — never orderIds, createdBy, or cost.
  return json({
    assignmentId: row.id, shortCode: d.shortCode, status: d.status,
    deliveryCompanyName: d.deliveryCompanyName, createdAt: d.createdAt, notes: d.notes,
    items: (d.items || []).map((it: any) => ({
      orderId: it.orderId, customerName: it.customerName, customerPhone: it.customerPhone,
      deliveryAddress: it.deliveryAddress, products: it.products, deliveryStatus: it.deliveryStatus, deliveredAt: it.deliveredAt,
    })),
  })
}

export async function updateDeliveryItem(req: Request, env: Env, shortCode: string, orderId: string): Promise<Response> {
  const { deliveryStatus, deliveredAt } = await req.json().catch(() => ({} as any))
  if (!['delivered', 'failed'].includes(deliveryStatus)) return json({ error: 'deliveryStatus must be delivered or failed' }, 400)
  const q = sql(env)
  const [row] = await q(`SELECT id, data FROM delivery_assignments WHERE short_code = $1 LIMIT 1`, [shortCode])
  if (!row) return json({ error: 'not_found' }, 404)
  const d = row.data
  if (d.status === 'completed') return json({ error: 'assignment_completed' }, 409)
  const items: any[] = d.items || []
  const idx = items.findIndex((it) => it.orderId === orderId)
  if (idx === -1) return json({ error: 'item_not_found' }, 404)
  items[idx] = { ...items[idx], deliveryStatus, deliveredAt: deliveredAt || now() }
  const allReported = items.every((it) => it.deliveryStatus === 'delivered' || it.deliveryStatus === 'failed')
  const anyUpdated = items.some((it) => it.deliveryStatus !== 'pending')
  const status = allReported ? 'all_reported' : anyUpdated ? 'in_progress' : 'pending'
  await q(`UPDATE delivery_assignments SET data = jsonb_set(jsonb_set(data,'{items}',$2::jsonb),'{status}',to_jsonb($3::text)) WHERE id = $1`,
    [row.id, JSON.stringify(items), status])
  return json({ ok: true })
}

export async function reconcile(req: Request, env: Env, assignmentId: string): Promise<Response> {
  const claims = await getClaims(req, env)
  if (!isAdmin(claims)) return json({ error: 'unauthorized' }, 401)
  try {
    const count = await transaction(env, async (q) => {
      const [row] = await q(`SELECT data FROM delivery_assignments WHERE id = $1 FOR UPDATE`, [assignmentId])
      if (!row) throw new Error('not_found')
      const items: any[] = row.data.items || []
      const toDeliver = items.filter((it) => it.deliveryStatus === 'delivered')
      if (!toDeliver.length) throw new Error('no_delivered_items')
      for (const it of toDeliver) {
        const [o] = await q(`SELECT data FROM orders WHERE id = $1 FOR UPDATE`, [it.orderId])
        if (!o) continue
        const updated = { ...o.data, delivered: true, status: 'delivered', deliveredAt: it.deliveredAt || now(),
          deliveredBy: row.data.deliveryCompanyName || 'External Delivery', modifiedAt: now(), modifiedBy: claims!.uid }
        await q(`UPDATE orders SET data = $2::jsonb WHERE id = $1`, [it.orderId, JSON.stringify(updated)])
      }
      const allResolved = items.every((it) => it.deliveryStatus === 'delivered' || it.deliveryStatus === 'failed')
      const newData = { ...row.data, status: allResolved ? 'completed' : 'in_progress', reconciledAt: now(), reconciledBy: claims!.uid }
      await q(`UPDATE delivery_assignments SET data = $2::jsonb WHERE id = $1`, [assignmentId, JSON.stringify(newData)])
      return toDeliver.length
    })
    return json({ ok: true, reconciledCount: count })
  } catch (err: any) {
    const m = err.message
    return json({ error: m }, m === 'not_found' ? 404 : m === 'no_delivered_items' ? 400 : 500)
  }
}

export async function unassignItem(req: Request, env: Env, assignmentId: string, orderId: string): Promise<Response> {
  const claims = await getClaims(req, env)
  if (!isAdmin(claims)) return json({ error: 'unauthorized' }, 401)
  const q = sql(env)
  const [row] = await q(`SELECT data FROM delivery_assignments WHERE id = $1`, [assignmentId])
  if (!row) return json({ error: 'not_found' }, 404)
  const d = row.data
  if (d.status === 'completed') return json({ error: 'assignment_completed' }, 409)
  const target = (d.items || []).find((it: any) => it.orderId === orderId)
  if (!target) return json({ error: 'item_not_found' }, 404)
  if (target.deliveryStatus !== 'pending') return json({ error: 'item_already_actioned' }, 409)
  const newItems = (d.items || []).filter((it: any) => it.orderId !== orderId)
  const newOrderIds = (d.orderIds || []).filter((x: string) => x !== orderId)
  if (!newItems.length) { await q(`DELETE FROM delivery_assignments WHERE id = $1`, [assignmentId]); return json({ ok: true, deleted: true }) }
  const allReported = newItems.every((it: any) => it.deliveryStatus === 'delivered' || it.deliveryStatus === 'failed')
  const anyUpdated = newItems.some((it: any) => it.deliveryStatus !== 'pending')
  const status = allReported ? 'all_reported' : anyUpdated ? 'in_progress' : 'pending'
  await q(`UPDATE delivery_assignments SET data = $2::jsonb WHERE id = $1`,
    [assignmentId, JSON.stringify({ ...d, items: newItems, orderIds: newOrderIds, status })])
  return json({ ok: true, deleted: false })
}
