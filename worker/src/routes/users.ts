// Admin user management (all admin-only) + self-service password change.
//   GET   /api/users                 list users
//   POST  /api/users                 create { email, role, password }
//   PATCH /api/users/:uid            update { role?, disabled? }
//   POST  /api/users/:uid/set-password  admin sets/resets { password } (a default the user may later change)
// Roles are tied to the app's authorization logic (route guards + collection ACL),
// so they are a fixed set rather than a dynamic lookup.
import { sql, type Env } from '../db'
import { json } from '../collections'
import { getClaims, isAdmin, hashPassword } from '../auth'

export const ASSIGNABLE_ROLES = ['admin', 'assistant', 'videographer'] as const
const isValidRole = (r: any) => r === null || r === '' || (ASSIGNABLE_ROLES as readonly string[]).includes(r)
const normRole = (r: any) => (r === '' || r === undefined ? null : r)

export async function handleUsers(req: Request, env: Env, parts: string[]): Promise<Response> {
  // parts = ['users', uid?, 'set-password'?]
  const claims = await getClaims(req, env)
  if (!isAdmin(claims)) return json({ error: 'forbidden' }, 403)
  const q = sql(env)
  const uid = parts[1]
  const action = parts[2]

  // GET /api/users
  if (req.method === 'GET' && !uid) {
    const rows = await q(
      `SELECT uid, email, role, disabled, created_at, (password_hash IS NOT NULL) AS has_password
         FROM users ORDER BY role NULLS LAST, email`)
    return json(rows)
  }

  // POST /api/users  (create)
  if (req.method === 'POST' && !uid) {
    const { email, role, password } = await req.json().catch(() => ({} as any))
    if (!email || !String(email).includes('@')) return json({ error: 'valid_email_required' }, 400)
    if (!isValidRole(role)) return json({ error: 'invalid_role' }, 400)
    const [dupe] = await q(`SELECT 1 FROM users WHERE email = $1`, [String(email).toLowerCase()])
    if (dupe) return json({ error: 'email_exists' }, 409)
    const newUid = crypto.randomUUID()
    const hash = password ? await hashPassword(String(password)) : null
    await q(
      `INSERT INTO users (uid, email, role, password_hash, custom_claims)
       VALUES ($1, $2, $3, $4, '{}'::jsonb)`,
      [newUid, String(email).toLowerCase(), normRole(role), hash])
    return json({ uid: newUid, email: String(email).toLowerCase(), role: normRole(role), has_password: !!hash }, 201)
  }

  if (!uid) return json({ error: 'not_found' }, 404)

  // PATCH /api/users/:uid  (role / disabled)
  if (req.method === 'PATCH' && !action) {
    const body = await req.json().catch(() => ({} as any))
    // Safety: an admin cannot lock themselves out (self-disable or self-demote).
    if (uid === claims!.uid && (body.disabled === true || (body.role !== undefined && normRole(body.role) !== 'admin')))
      return json({ error: 'cannot_change_own_admin_status' }, 400)
    const sets: string[] = []
    const params: any[] = [uid]
    if (body.role !== undefined) {
      if (!isValidRole(body.role)) return json({ error: 'invalid_role' }, 400)
      params.push(normRole(body.role)); sets.push(`role = $${params.length}`)
    }
    if (body.disabled !== undefined) { params.push(!!body.disabled); sets.push(`disabled = $${params.length}`) }
    if (!sets.length) return json({ error: 'nothing_to_update' }, 400)
    const [row] = await q(`UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE uid = $1
                            RETURNING uid, email, role, disabled`, params)
    return row ? json(row) : json({ error: 'not_found' }, 404)
  }

  // POST /api/users/:uid/set-password  (admin default/reset)
  if (req.method === 'POST' && action === 'set-password') {
    const { password } = await req.json().catch(() => ({} as any))
    if (!password || String(password).length < 8) return json({ error: 'password_min_8' }, 400)
    const hash = await hashPassword(String(password))
    const [row] = await q(
      `UPDATE users SET password_hash = $2, reset_token = NULL, reset_expires = NULL, updated_at = now()
        WHERE uid = $1 RETURNING uid, email`, [uid, hash])
    return row ? json({ ok: true, uid: row.uid }) : json({ error: 'not_found' }, 404)
  }

  return json({ error: 'not_found' }, 404)
}
