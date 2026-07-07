// Frontend data-access compat layer — the single seam between the app and the
// backend. Replaces direct Firestore SDK calls with REST calls to the Cloudflare
// Worker (/api/collections/*). Migrate a screen by swapping its inline Firestore
// calls for these helpers; unmigrated screens keep using firebaseClient until then.
//
// Firestore → dataClient cheat-sheet:
//   getDocs(query(collection(db,'orders'), orderBy('createdAt','desc')))
//     → listDocs('orders', { orderBy: { field: 'createdAt', dir: 'desc' } })
//   getDoc(doc(db,'orders',id))        → getDocById('orders', id)
//   addDoc(collection(db,'x'), data)   → createDoc('x', data)
//   updateDoc(doc(db,'x',id), partial) → updateDocById('x', id, partial)
//   deleteDoc(doc(db,'x',id))          → deleteDocById('x', id)
//   onSnapshot(...)                    → useLiveCollection(...)  (see hooks/useLiveCollection)
//
// serverTimestamp() is gone: the Worker stamps createdAt/createdBy/modifiedAt
// server-side (audit hooks), so callers no longer send timestamps.

const env = (import.meta as any).env || {}
export const API_BASE: string = (env.VITE_API_BASE || '').replace(/\/$/, '')

export interface Doc { id: string; [k: string]: any }
export type WhereOp = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'array-contains'
export interface Filter { field: string; op: WhereOp; value: any }
export interface QuerySpec {
  where?: Filter[]
  orderBy?: { field: string; dir?: 'asc' | 'desc' }
  limit?: number
}

// ── token storage (set by authClient on login) ──
const TOKEN_KEY = 'eh_jwt'
export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t: string | null) => t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY)

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const t = getToken()
  return { ...extra, ...(t ? { Authorization: `Bearer ${t}` } : {}) }
}

async function req(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${API_BASE}${path}`, init)
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  if (!res.ok) throw new ApiError(body?.error || res.statusText, res.status, body)
  return body
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public body?: any) { super(message) }
}

// ── generic collection CRUD ──
export async function listDocs(collection: string, spec?: QuerySpec): Promise<Doc[]> {
  const qs = spec ? `?q=${btoa(JSON.stringify(spec))}` : ''
  return req(`/api/collections/${collection}${qs}`, { headers: authHeaders() })
}

export async function getDocById(collection: string, id: string): Promise<Doc | null> {
  try { return await req(`/api/collections/${collection}/${id}`, { headers: authHeaders() }) }
  catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e }
}

export async function createDoc(collection: string, data: Record<string, any>): Promise<Doc> {
  return req(`/api/collections/${collection}`, {
    method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(data),
  })
}

export async function updateDocById(collection: string, id: string, partial: Record<string, any>): Promise<Doc> {
  return req(`/api/collections/${collection}/${id}`, {
    method: 'PATCH', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(partial),
  })
}

export async function deleteDocById(collection: string, id: string): Promise<void> {
  await req(`/api/collections/${collection}/${id}`, { method: 'DELETE', headers: authHeaders() })
}

// ── custom (non-CRUD) routes: orders markPaid/edit/delete, delivery, rag, upload ──
export async function callApi(path: string, opts: { method?: string; body?: any } = {}): Promise<any> {
  return req(path, {
    method: opts.method || 'POST',
    headers: authHeaders(opts.body ? { 'Content-Type': 'application/json' } : {}),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
}

// Media upload → R2 via the Worker (replaces client-side Firebase Storage upload).
// Returns the public URL to persist into the doc (products.imageUrl, gallery.url, …).
export async function uploadMedia(file: File, key: string): Promise<{ url: string; key: string }> {
  const form = new FormData()
  form.append('file', file)
  form.append('key', key)
  const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', headers: authHeaders(), body: form })
  if (!res.ok) throw new ApiError('upload_failed', res.status)
  return res.json()
}

// Convenience for building the two array 'orderBy' style Firestore filters.
export const where = (field: string, op: WhereOp, value: any): Filter => ({ field, op, value })
