// Self-hosted auth replacing Firebase Auth.
// - Passwords: bcrypt (bcryptjs, pure-JS → runs in Workers).
// - Sessions:  HMAC-SHA256 JWT signed with JWT_SECRET (Web Crypto).
// - Roles:     the `users.role` column (admin | assistant | videographer | null),
//              mirroring the old Firebase custom claims. Server route guards below
//              reproduce what firestore.rules + verifyAdmin used to enforce.
import bcrypt from 'bcryptjs'
import type { Env } from './db'

const enc = new TextEncoder()
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as any))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlToBytes = (s: string) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export interface Claims { uid: string; email?: string | null; role?: string | null; iat: number; exp: number }

export async function signJwt(env: Env, payload: Omit<Claims, 'iat' | 'exp'>, ttlSeconds = 60 * 60 * 12): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const body: Claims = { ...payload, iat: now, exp: now + ttlSeconds }
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const claims = b64url(enc.encode(JSON.stringify(body)))
  const key = await hmacKey(env.JWT_SECRET)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${claims}`))
  return `${header}.${claims}.${b64url(sig)}`
}

export async function verifyJwt(env: Env, token: string): Promise<Claims | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, claims, sig] = parts
  const key = await hmacKey(env.JWT_SECRET)
  const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sig), enc.encode(`${header}.${claims}`))
  if (!ok) return null
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(claims))) as Claims
  if (payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10)
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash)

// ── Request guards (mirror verifyAdmin / requireAuth from the old functions) ──
function bearer(req: Request): string | null {
  const h = req.headers.get('Authorization') || ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

export async function getClaims(req: Request, env: Env): Promise<Claims | null> {
  const t = bearer(req)
  return t ? verifyJwt(env, t) : null
}

export function isAdmin(c: Claims | null): boolean {
  return !!c && c.role === 'admin'
}

// Roles allowed to write a given collection, reproducing firestore.rules intent.
// null role value = any signed-in user; '*' = public (no auth).
export const COLLECTION_ACL: Record<string, { read: string; write: string[] }> = {
  staff:                { read: 'admin',    write: ['admin'] },
  assets:               { read: 'admin',    write: ['admin'] },
  revenue:              { read: 'admin',    write: ['admin'] },
  orders_audit:         { read: 'admin',    write: ['admin'] },
  product_audit:        { read: 'admin',    write: ['admin'] },
  expense_items:        { read: 'staff',    write: ['admin', 'assistant'] },
  expense_categories:   { read: 'staff',    write: ['admin'] },
  customer_followups:   { read: 'admin',    write: ['admin'] },
  products:             { read: 'signedin', write: ['admin'] },
  customer_categories:  { read: 'signedin', write: ['admin'] },
  customer_allergies:   { read: 'signedin', write: ['admin'] },
  customers:            { read: 'staff',    write: ['admin', 'assistant'] },
  orders:               { read: 'staff',    write: ['admin', 'assistant'] },
  top_customers:        { read: 'admin',    write: ['admin'] },
  product_reviews:      { read: 'signedin', write: ['admin'] },
  gallery:              { read: 'public',   write: ['admin', 'videographer'] },
  delivery_assignments: { read: 'admin',    write: ['admin'] },
}

export function canRead(acl: { read: string }, c: Claims | null): boolean {
  switch (acl.read) {
    case 'public': return true
    case 'signedin': return !!c
    case 'staff': return !!c && ['admin', 'assistant', 'videographer'].includes(c.role || '')
    case 'admin': return isAdmin(c)
    default: return false
  }
}
export function canWrite(acl: { write: string[] }, c: Claims | null): boolean {
  return !!c && acl.write.includes(c.role || '')
}
