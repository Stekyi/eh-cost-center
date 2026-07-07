// Ported order mutation routes (were functions/src/index.ts):
//   POST /api/orders/:id/markPaid
//   POST /api/orders/:id/edit
//   POST /api/orders/:id/delete
// Money-touching writes use an interactive transaction (Neon Pool) — the
// equivalent of the old Firestore runTransaction / writeBatch.
import { transaction, sql, type Env } from '../db'
import { json } from '../collections'
import { getClaims, isAdmin, type Claims } from '../auth'

const now = () => new Date().toISOString()

export async function markPaid(req: Request, env: Env, orderId: string): Promise<Response> {
  const { amountPaid, deliveryFee = 0, valueDate } = await req.json().catch(() => ({} as any))
  if (typeof amountPaid !== 'number' || amountPaid <= 0) return json({ error: 'amount must be > 0' }, 400)

  try {
    await transaction(env, async (q) => {
      const [orderRow] = await q(`SELECT data FROM orders WHERE id = $1 FOR UPDATE`, [orderId])
      if (!orderRow) throw new Error('Order not found')
      const order = orderRow.data
      const items: any[] = order.items || []
      if (!items.length) throw new Error('Order has no items')

      const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean))]
      const prods = productIds.length
        ? await q(`SELECT id, data FROM products WHERE id = ANY($1)`, [productIds]) : []
      const priceMap: Record<string, any> = {}
      for (const p of prods) priceMap[p.id] = p.data

      const orderTotal = items.reduce((sum, it) => {
        const p = priceMap[it.productId] || {}
        // Must match the frontend lineTotal() in OrderDetail.tsx exactly.
        const unit = Number(p.unitCost ?? p.price ?? 0)
        return sum + Number(it.qtyPackages ?? it.qty ?? 0) * Number(p.unitsPerPackage ?? 1) * unit
      }, 0)
      const fee = Number(deliveryFee || 0)
      if (Math.abs(orderTotal + fee - amountPaid) > 1e-4)
        throw new Error('Amount, delivery fee, and order total must balance to zero')

      const paidAt = valueDate ? new Date(valueDate).toISOString() : now()

      let customerTel = ''
      if (order.customerId) {
        const [cust] = await q(`SELECT data FROM customers WHERE id = $1`, [order.customerId])
        if (cust) customerTel = cust.data.telephone || cust.data.phone || ''
      }

      const newOrder = { ...order, paid: true, amountPaid, deliveryFee: fee, paidAt, total: orderTotal }
      await q(`UPDATE orders SET data = $2::jsonb WHERE id = $1`, [orderId, JSON.stringify(newOrder)])

      await q(`INSERT INTO order_payments (id, order_id, data) VALUES ($1,$2,$3::jsonb)`,
        [crypto.randomUUID(), orderId, JSON.stringify({ amount: amountPaid, deliveryFee: fee, recordedAt: paidAt })])

      await q(`INSERT INTO revenue (id, data) VALUES ($1,$2::jsonb)`,
        [crypto.randomUUID(), JSON.stringify({
          orderId, orderNumber: orderId, customerTel, amountPaid, deliveryFee: fee,
          valueDate: paidAt, type: 'order_payment', createdAt: now(),
        })])
    })
    return json({ ok: true })
  } catch (err: any) {
    return json({ error: err.message }, 400)
  }
}

export async function editOrder(req: Request, env: Env, orderId: string): Promise<Response> {
  const claims = await getClaims(req, env)
  if (!claims) return json({ error: 'missing_token' }, 401)
  const { items: newItems, amountPaid: newAmountPaid, deliveryFee: newDeliveryFee, adminOverrideReason } =
    await req.json().catch(() => ({} as any))

  try {
    const auditId = await transaction(env, async (q) => {
      const [orderRow] = await q(`SELECT data FROM orders WHERE id = $1 FOR UPDATE`, [orderId])
      if (!orderRow) throw new Error('Order not found')
      const order = orderRow.data
      const itemsToUse: any[] = Array.isArray(newItems) ? newItems : (order.items || [])
      if (!itemsToUse.length) throw new Error('missing_items')

      const productIds = [...new Set(itemsToUse.map((i) => i.productId).filter(Boolean))]
      const prods = productIds.length ? await q(`SELECT id, data FROM products WHERE id = ANY($1)`, [productIds]) : []
      const priceMap: Record<string, any> = {}
      for (const p of prods) priceMap[p.id] = p.data

      const orderTotal = itemsToUse.reduce((sum, it) => {
        const p = priceMap[it.productId] || {}
        return sum + Number(it.qtyPackages ?? it.qty ?? 0) * Number(p.unitsPerPackage ?? 1) * Number(p.unitCost ?? p.price ?? 0)
      }, 0)
      const amt = typeof newAmountPaid === 'number' ? newAmountPaid : Number(order.amountPaid || 0)
      const fee = typeof newDeliveryFee === 'number' ? newDeliveryFee : Number(order.deliveryFee || 0)
      if ((typeof newAmountPaid === 'number' || typeof newDeliveryFee === 'number') && Math.abs(amt - fee - orderTotal) > 1e-6)
        throw new Error('payment_mismatch')

      const changes: any = {}
      const updated: any = { ...order, total: orderTotal, modifiedAt: now(), modifiedBy: claims.uid }
      if (Array.isArray(newItems)) { updated.items = newItems; changes.items = { before: order.items || null, after: newItems } }
      if (typeof newAmountPaid === 'number') { updated.amountPaid = amt; changes.amountPaid = { before: order.amountPaid ?? null, after: amt } }
      if (typeof newDeliveryFee === 'number') { updated.deliveryFee = fee; changes.deliveryFee = { before: order.deliveryFee ?? null, after: fee } }

      await q(`UPDATE orders SET data = $2::jsonb WHERE id = $1`, [orderId, JSON.stringify(updated)])
      const auditRowId = crypto.randomUUID()
      await q(`INSERT INTO orders_audit (id, data) VALUES ($1,$2::jsonb)`, [auditRowId, JSON.stringify({
        orderId, actorUid: claims.uid, isAdmin: isAdmin(claims), changes, total: orderTotal,
        adminOverrideReason: adminOverrideReason || null, createdAt: now(),
      })])
      return auditRowId
    })
    return json({ ok: true, orderId, auditId })
  } catch (err: any) {
    return json({ error: err.message || 'edit_failed' }, 400)
  }
}

export async function deleteOrder(req: Request, env: Env, orderId: string): Promise<Response> {
  const claims = await getClaims(req, env)
  if (!claims) return json({ error: 'missing_token' }, 401)
  const { passcode } = await req.json().catch(() => ({} as any))

  try {
    // Passcode gate for paid orders — value comes from app_parameters (no hardcoding).
    const [orderRow] = await sql(env)(`SELECT data FROM orders WHERE id = $1`, [orderId])
    if (!orderRow) return json({ error: 'order_not_found' }, 404)
    if (orderRow.data.paid) {
      const [param] = await sql(env)(`SELECT parameter_value FROM app_parameters WHERE parameter_key='ORDER_DELETE_PASSCODE'`)
      const required = param?.parameter_value
      if (!required) return json({ error: 'passcode_not_configured' }, 500)
      if (String(passcode || '') !== String(required)) return json({ error: 'invalid_passcode' }, 403)
    }

    await transaction(env, async (q) => {
      // order_payments cascade via FK ON DELETE CASCADE; revenue matched by orderId.
      await q(`DELETE FROM revenue WHERE order_id = $1`, [orderId])
      await q(`DELETE FROM orders WHERE id = $1`, [orderId])
      await q(`INSERT INTO orders_audit (id, data) VALUES ($1,$2::jsonb)`, [crypto.randomUUID(), JSON.stringify({
        orderId, actorUid: claims.uid, isAdmin: isAdmin(claims), action: 'delete',
        paid: !!orderRow.data.paid, amountPaid: Number(orderRow.data.amountPaid || 0),
        deliveryFee: Number(orderRow.data.deliveryFee || 0), createdAt: now(),
      })])
    })
    return json({ ok: true, orderId })
  } catch (err: any) {
    return json({ error: err?.message || 'delete_failed' }, 400)
  }
}
