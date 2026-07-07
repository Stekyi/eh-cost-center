// Generic collection REST endpoint — the backend for the frontend compat layer
// (src/utils/dataClient.ts). Speaks in Firestore collection names and returns
// Firestore-shaped documents ({ id, ...data }). Enforces the collection ACL,
// stamps audit fields, and runs the per-collection write hooks that used to be
// Firestore triggers (expense audit/archive, review rating recalc).
//
//   GET    /api/collections/:name            list (query via ?q=<base64 json>)
//   GET    /api/collections/:name/:id        get one
//   POST   /api/collections/:name            create  (body = document data)
//   PATCH  /api/collections/:name/:id        update  (body = partial data)
//   DELETE /api/collections/:name/:id        delete
import { sql, toDoc, type Env } from './db'
import { COLLECTION_ACL, canRead, canWrite, type Claims } from './auth'
import { stampCreate, stampUpdate } from './audit'
import { onExpenseWrite, onExpenseDelete, recalcProductRating } from './hooks'

// Firestore collection name → { table, aclKey, queryable columns }.
// `queryable` maps a document field to a real (indexed generated) column so
// filters/sorts on it use an index; unlisted fields fall back to data->>'field'.
type TableDef = { table: string; acl: string; queryable: Record<string, string> }
const MAP: Record<string, TableDef> = {
  customers:            { table: 'customers',            acl: 'customers',            queryable: { name: 'name', createdAt: 'created_at' } },
  products:             { table: 'products',             acl: 'products',             queryable: { createdAt: 'created_at' } },
  orders:               { table: 'orders',               acl: 'orders',               queryable: { customerId: 'customer_id', paid: 'paid', delivered: 'delivered', status: 'status', createdAt: 'created_at' } },
  revenue:              { table: 'revenue',               acl: 'revenue',              queryable: { orderId: 'order_id', createdAt: 'created_at' } },
  expenseItems:         { table: 'expense_items',         acl: 'expense_items',        queryable: { valueDate: 'value_date', createdAt: 'created_at' } },
  expenseItems_audit:   { table: 'expense_items_audit',   acl: 'expense_items',        queryable: {} },
  expenseCategories:    { table: 'expense_categories',    acl: 'expense_categories',   queryable: { code: 'code' } },
  customerCategories:   { table: 'customer_categories',   acl: 'customer_categories',  queryable: { code: 'code' } },
  customerAllergies:    { table: 'customer_allergies',    acl: 'customer_allergies',   queryable: { code: 'code' } },
  staff:                { table: 'staff',                 acl: 'staff',                queryable: {} },
  assets:               { table: 'assets',                acl: 'assets',               queryable: {} },
  top_customers:        { table: 'top_customers',         acl: 'top_customers',        queryable: { month: 'month', customerId: 'customer_id' } },
  customer_followups:   { table: 'customer_followups',    acl: 'customer_followups',   queryable: {} },
  gallery:              { table: 'gallery',               acl: 'gallery',              queryable: { createdAt: 'created_at' } },
  delivery_assignments: { table: 'delivery_assignments',  acl: 'delivery_assignments', queryable: { status: 'status', shortCode: 'short_code', createdAt: 'created_at' } },
  product_reviews:      { table: 'product_reviews',       acl: 'product_reviews',      queryable: { productId: 'product_id', customerId: 'customer_id', orderId: 'order_id' } },
  orders_audit:         { table: 'orders_audit',          acl: 'orders_audit',         queryable: {} },
  product_audit:        { table: 'product_audit',         acl: 'product_audit',        queryable: {} },
}

interface Filter { field: string; op: string; value: any }
interface Query { where?: Filter[]; orderBy?: { field: string; dir?: 'asc' | 'desc' }; limit?: number }

function colExpr(def: TableDef, field: string): string {
  const mapped = def.queryable[field]
  if (mapped) return mapped
  return `(data->>'${field.replace(/'/g, "''")}')` // arbitrary field, text compare
}

function buildWhere(def: TableDef, filters: Filter[], params: any[]): string {
  const clauses: string[] = []
  for (const f of filters) {
    if (f.op === 'array-contains') {
      params.push(String(f.value))
      clauses.push(`(data->'${f.field.replace(/'/g, "''")}') ? $${params.length}`)
      continue
    }
    if (f.op === 'in') {
      params.push(f.value)
      clauses.push(`${colExpr(def, f.field)} = ANY($${params.length})`)
      continue
    }
    const opSql = ({ '==': '=', '!=': '<>', '>': '>', '>=': '>=', '<': '<', '<=': '<=' } as any)[f.op]
    if (!opSql) throw new Error(`unsupported op ${f.op}`)
    params.push(f.value)
    clauses.push(`${colExpr(def, f.field)} ${opSql} $${params.length}`)
  }
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
}

export async function handleCollections(req: Request, env: Env, claims: Claims | null, parts: string[]): Promise<Response> {
  // parts = ['collections', name, id?]
  const name = parts[1]
  const id = parts[2]
  const def = MAP[name]
  if (!def) return json({ error: 'unknown_collection' }, 404)
  const acl = COLLECTION_ACL[def.acl]

  const q = sql(env)

  // ── READ ──
  if (req.method === 'GET') {
    if (!canRead(acl, claims)) return json({ error: 'forbidden' }, 403)
    if (id) {
      const rows = await q(`SELECT id, data FROM ${def.table} WHERE id = $1`, [id])
      return rows.length ? json(toDoc(rows[0])) : json({ error: 'not_found' }, 404)
    }
    const query = parseQuery(req)
    const params: any[] = []
    const where = query.where ? buildWhere(def, query.where, params) : ''
    let text = `SELECT id, data FROM ${def.table} ${where}`
    if (query.orderBy) text += ` ORDER BY ${colExpr(def, query.orderBy.field)} ${query.orderBy.dir === 'desc' ? 'DESC' : 'ASC'}`
    if (query.limit) text += ` LIMIT ${Number(query.limit)}`
    const rows = await q(text, params) as any
    return json((rows as any[]).map(toDoc))
  }

  // ── WRITES ──
  if (!canWrite(acl, claims)) return json({ error: 'forbidden' }, 403)

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}))
    const docId = (body as any).id || crypto.randomUUID()
    const data = stampCreate(stripId(body), claims)
    await q(`INSERT INTO ${def.table} (id, data) VALUES ($1, $2::jsonb)`, [docId, JSON.stringify(data)])
    await afterWrite(env, name, docId, data, null)
    return json({ id: docId, ...data }, 201)
  }

  if ((req.method === 'PATCH' || req.method === 'PUT') && id) {
    const body = await req.json().catch(() => ({}))
    const before = (await q(`SELECT data FROM ${def.table} WHERE id = $1`, [id]))[0]?.data || null
    const merged = stampUpdate({ ...(before || {}), ...stripId(body) }, claims)
    await q(`UPDATE ${def.table} SET data = $2::jsonb WHERE id = $1`, [id, JSON.stringify(merged)])
    await afterWrite(env, name, id, merged, before)
    return json({ id, ...merged })
  }

  if (req.method === 'DELETE' && id) {
    const before = (await q(`SELECT data FROM ${def.table} WHERE id = $1`, [id]))[0]?.data || null
    await q(`DELETE FROM ${def.table} WHERE id = $1`, [id])
    await afterDelete(env, name, id, before, claims)
    return json({ ok: true })
  }

  return json({ error: 'method_not_allowed' }, 405)
}

// Per-collection hooks replacing Firestore triggers.
async function afterWrite(env: Env, name: string, id: string, data: any, before: any) {
  if (name === 'expenseItems') await onExpenseWrite(env, id, data, before)
  if (name === 'product_reviews') await recalcProductRating(env, data.productId)
}
async function afterDelete(env: Env, name: string, id: string, before: any, claims: Claims | null) {
  if (name === 'expenseItems') await onExpenseDelete(env, id, before, claims)
  if (name === 'product_reviews' && before?.productId) await recalcProductRating(env, before.productId)
}

function parseQuery(req: Request): Query {
  const u = new URL(req.url)
  const raw = u.searchParams.get('q')
  if (!raw) return {}
  try { return JSON.parse(atob(raw)) } catch { return {} }
}
function stripId(body: any) { const { id, ...rest } = body || {}; return rest }
export function json(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } })
}
