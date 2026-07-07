// Frontend auth compat layer — replaces the Firebase Auth client SDK usage in
// Login.tsx / App.tsx / RoleContext. Talks to the Worker's /api/auth/* routes
// and stores the JWT via dataClient's token storage.
//
// Migration mapping:
//   signInWithEmailAndPassword(auth, email, pw)  → authClient.login(email, pw)
//   auth.signOut()                               → authClient.logout()
//   auth.onAuthStateChanged(cb)                  → authClient.onChange(cb)
//   user.getIdTokenResult().claims.role/admin    → (await authClient.current())?.role
//   sendPasswordResetEmail(auth, email)          → authClient.requestReset(email)
import { API_BASE, getToken, setToken } from './dataClient'

export type StaffRole = 'admin' | 'videographer' | 'assistant'
export interface AuthUser { uid: string; email: string | null; role: StaffRole | null }

type Listener = (u: AuthUser | null) => void
const listeners = new Set<Listener>()
let cached: AuthUser | null = null

function notify() { for (const l of listeners) l(cached) }

export async function login(email: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || 'login_failed')
  setToken(body.token)
  cached = body.user
  notify()
  return body.user
}

export function logout(): void {
  setToken(null)
  cached = null
  notify()
}

// Resolve the current user from the stored token (verifies server-side).
export async function current(): Promise<AuthUser | null> {
  if (!getToken()) { cached = null; return null }
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${getToken()}` } })
    if (!res.ok) { logout(); return null }
    const body = await res.json()
    cached = body.user
    return cached
  } catch { return cached }
}

// onAuthStateChanged equivalent: fires immediately with the resolved user, then
// on every login/logout. Returns an unsubscribe function.
export function onChange(cb: Listener): () => void {
  listeners.add(cb)
  current().then(() => cb(cached))
  return () => listeners.delete(cb)
}

export async function requestReset(email: string): Promise<void> {
  await fetch(`${API_BASE}/api/auth/request-reset`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  })
}

export async function completeReset(token: string, password: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/reset`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }),
  })
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.error || 'reset_failed') }
}
