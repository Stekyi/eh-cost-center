// Neon Postgres access for the Worker. Uses the HTTP driver for one-shot
// queries and the WebSocket Pool for multi-statement transactions (markPaid,
// edit, cascade deletes) — the equivalents of Firestore runTransaction/batch.
import { neon, Pool } from '@neondatabase/serverless'

export interface Env {
  NEON_DATABASE_URL: string
  JWT_SECRET: string
  // R2
  MEDIA: R2Bucket
  R2_PUBLIC_BASE: string
  // RAG / secrets
  HUGGINGFACE_API_TOKEN?: string
  FIREWORKS_API_KEY?: string
  RAG_ALLOW_ANON?: string
}

// Returns a parameterized query function backed by the Neon HTTP driver.
// `q(text, params)` uses numbered placeholders ($1, $2, …) and resolves to the
// rows array directly (never string-interpolate user input into `text`).
export function sql(env: Env): (text: string, params?: any[]) => Promise<any[]> {
  const c = neon(env.NEON_DATABASE_URL)
  // The neon() http function is callable as sql(text, paramsArray) for
  // parameterized queries (a plain string arg selects this overload over the
  // tagged-template one). Resolves to the rows array (fullResults=false).
  return (text: string, params: any[] = []) => c(text, params) as unknown as Promise<any[]>
}

// Run a set of statements atomically. `fn` receives a `q(text, params)` helper.
export async function transaction<T>(
  env: Env,
  fn: (q: (text: string, params?: any[]) => Promise<any[]>) => Promise<T>
): Promise<T> {
  const pool = new Pool({ connectionString: env.NEON_DATABASE_URL })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const q = async (text: string, params: any[] = []) => (await client.query(text, params)).rows
    const result = await fn(q)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

// A stored row → the shape the frontend expects: { id, ...data }.
// This mirrors a Firestore document snapshot ({ id, ...doc.data() }).
export function toDoc(row: any): any {
  if (!row) return null
  const { id, data } = row
  return { id, ...(data || {}) }
}
