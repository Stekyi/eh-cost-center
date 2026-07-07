// Cloudflare Worker entry — replaces the Firebase Cloud Functions `api` export.
// Routes:
//   /api/auth/*             self-hosted auth (login, me, reset)
//   /api/collections/*      generic CRUD (frontend compat-layer backend)
//   /api/orders/:id/*       markPaid | edit | delete
//   /api/delivery-assignments/*   admin delivery management
//   /delivery/:shortCode*   public delivery status (no /api prefix, unauthenticated)
//   /customer/*             Flutter customer app (contract preserved)
//   /api/rag/query          RAG (pgvector)
//   /api/upload             media upload → R2
import type { Env } from './db'
import { sql } from './db'
import { getClaims, canWrite, COLLECTION_ACL } from './auth'
import { handleCollections, json } from './collections'
import { markPaid, editOrder, deleteOrder } from './routes/orders'
import { createAssignment, getDelivery, updateDeliveryItem, reconcile, unassignItem } from './routes/delivery'
import { handleCustomer } from './routes/customer'
import { login, me, requestReset, reset, changePassword } from './routes/authRoutes'
import { handleUsers } from './routes/users'
import { ragQuery } from './routes/rag'
import { runWeeklyOrderCount } from './cron'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}
const withCors = (res: Response) => { for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v); return res }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    try {
      return withCors(await route(req, env))
    } catch (err: any) {
      return withCors(json({ error: err?.message || 'internal_error' }, 500))
    }
  },
  // Cloudflare Cron Trigger → replaces the pubsub updateWeeklyOrderCount job.
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await runWeeklyOrderCount(env)
  },
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url)
  const seg = url.pathname.split('/').filter(Boolean) // e.g. ['api','orders','abc','edit']

  // Public / non-/api prefixes first.
  if (seg[0] === 'delivery') {
    if (req.method === 'GET' && seg.length === 2) return getDelivery(env, seg[1])
    if (req.method === 'PUT' && seg[2] === 'items' && seg[3]) return updateDeliveryItem(req, env, seg[1], seg[3])
    return json({ error: 'not_found' }, 404)
  }
  if (seg[0] === 'customer') return handleCustomer(req, env, seg)

  if (seg[0] !== 'api') return json({ error: 'not_found' }, 404)
  const parts = seg.slice(1) // drop 'api'

  // Health
  if (parts[0] === 'health') return json({ ok: true })

  // Auth
  if (parts[0] === 'auth') {
    if (req.method === 'POST' && parts[1] === 'login') return login(req, env)
    if (req.method === 'GET' && parts[1] === 'me') return me(req, env)
    if (req.method === 'POST' && parts[1] === 'request-reset') return requestReset(req, env)
    if (req.method === 'POST' && parts[1] === 'reset') return reset(req, env)
    if (req.method === 'POST' && parts[1] === 'change-password') return changePassword(req, env)
    return json({ error: 'not_found' }, 404)
  }

  // User management (admin only)
  if (parts[0] === 'users') return handleUsers(req, env, parts)

  // Collections (generic CRUD)
  if (parts[0] === 'collections') {
    const claims = await getClaims(req, env)
    return handleCollections(req, env, claims, parts)
  }

  // Order mutations
  if (parts[0] === 'orders' && parts[2]) {
    if (parts[2] === 'markPaid') return markPaid(req, env, parts[1])
    if (parts[2] === 'edit') return editOrder(req, env, parts[1])
    if (parts[2] === 'delete') return deleteOrder(req, env, parts[1])
  }

  // Delivery assignments (admin)
  if (parts[0] === 'delivery-assignments') {
    if (req.method === 'POST' && parts.length === 1) return createAssignment(req, env)
    if (req.method === 'POST' && parts[2] === 'reconcile') return reconcile(req, env, parts[1])
    if (req.method === 'DELETE' && parts[2] === 'items' && parts[3]) return unassignItem(req, env, parts[1], parts[3])
  }

  // RAG
  if (req.method === 'POST' && parts[0] === 'rag' && parts[1] === 'query') return ragQuery(req, env)

  // Media upload → R2 (replaces client-side Firebase Storage uploads)
  if (req.method === 'POST' && parts[0] === 'upload') return uploadMedia(req, env)

  return json({ error: 'not_found' }, 404)
}

// POST /api/upload  — form field `file` + `key` (e.g. products/{id}/image).
// Authz reproduces storage.rules: admin for products/*, admin|videographer for gallery/*.
async function uploadMedia(req: Request, env: Env): Promise<Response> {
  const claims = await getClaims(req, env)
  const form = await req.formData()
  const file = form.get('file') as unknown as File | null
  const key = String(form.get('key') || '')
  if (!file || !key) return json({ error: 'file_and_key_required' }, 400)

  const aclKey = key.startsWith('gallery/') ? 'gallery' : 'products'
  if (!canWrite(COLLECTION_ACL[aclKey], claims)) return json({ error: 'forbidden' }, 403)

  await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } })
  const publicUrl = `${env.R2_PUBLIC_BASE.replace(/\/$/, '')}/${key}`
  return json({ url: publicUrl, key })
}
