// Self-hosted auth endpoints (replace Firebase Auth client SDK):
//   POST /api/auth/login          { email, password } → { token, user }
//   GET  /api/auth/me                                  → { user }   (Bearer)
//   POST /api/auth/request-reset  { email }            → { ok }     (issues reset token)
//   POST /api/auth/reset          { token, password }  → { ok }     (sets password)
import { sql, type Env } from '../db'
import { json } from '../collections'
import { signJwt, verifyJwt, hashPassword, checkPassword } from '../auth'

export async function login(req: Request, env: Env): Promise<Response> {
  const { email, password } = await req.json().catch(() => ({} as any))
  if (!email || !password) return json({ error: 'missing' }, 400)
  const [u] = await sql(env)(`SELECT uid, email, role, password_hash, disabled FROM users WHERE email = $1`, [String(email).toLowerCase()])
  if (!u || u.disabled) return json({ error: 'invalid' }, 401)
  if (!u.password_hash) return json({ error: 'password_reset_required' }, 403) // migrated users must reset first
  if (!(await checkPassword(password, u.password_hash))) return json({ error: 'invalid' }, 401)
  const token = await signJwt(env, { uid: u.uid, email: u.email, role: u.role })
  return json({ token, user: { uid: u.uid, email: u.email, role: u.role } })
}

export async function me(req: Request, env: Env): Promise<Response> {
  const h = req.headers.get('Authorization') || ''
  const claims = h.startsWith('Bearer ') ? await verifyJwt(env, h.slice(7)) : null
  if (!claims) return json({ error: 'unauthorized' }, 401)
  return json({ user: { uid: claims.uid, email: claims.email, role: claims.role } })
}

export async function requestReset(req: Request, env: Env): Promise<Response> {
  const { email } = await req.json().catch(() => ({} as any))
  if (!email) return json({ error: 'missing' }, 400)
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1h
  await sql(env)(`UPDATE users SET reset_token = $2, reset_expires = $3::timestamptz WHERE email = $1`,
    [String(email).toLowerCase(), token, expires])
  // Do not leak existence; caller sends the email out-of-band (see send-reset-emails.js).
  return json({ ok: true })
}

export async function reset(req: Request, env: Env): Promise<Response> {
  const { token, password } = await req.json().catch(() => ({} as any))
  if (!token || !password || String(password).length < 8) return json({ error: 'invalid_input' }, 400)
  const [u] = await sql(env)(`SELECT uid, reset_expires FROM users WHERE reset_token = $1`, [token])
  if (!u || (u.reset_expires && new Date(u.reset_expires) < new Date())) return json({ error: 'invalid_or_expired' }, 400)
  const hash = await hashPassword(password)
  await sql(env)(`UPDATE users SET password_hash = $2, reset_token = NULL, reset_expires = NULL, updated_at = now() WHERE uid = $1`, [u.uid, hash])
  return json({ ok: true })
}
