// App-level replacements for the Firestore triggers in expenseTriggers.ts and
// reviewTriggers.ts. Called by the collection write layer after each mutation.
import { sql, type Env } from './db'
import type { Claims } from './auth'

// expenseItems onCreate/onUpdate → append an immutable audit row.
export async function onExpenseWrite(env: Env, id: string, after: any, before: any) {
  const q = sql(env)
  const audit = {
    expenseItemId: id,
    action: before ? 'update' : 'create',
    before: before || null,
    after,
    createdAt: new Date().toISOString(),
  }
  await q(`INSERT INTO expense_items_audit (id, data) VALUES ($1, $2::jsonb)`,
    [crypto.randomUUID(), JSON.stringify(audit)])
}

// expenseItems onDelete → archive the doc, then write a delete audit row.
export async function onExpenseDelete(env: Env, id: string, before: any, claims: Claims | null) {
  if (!before) return
  const q = sql(env)
  await q(`INSERT INTO expense_items_archive (id, data) VALUES ($1, $2::jsonb)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [id, JSON.stringify({ ...before, archivedAt: new Date().toISOString(), archivedBy: claims?.email || claims?.uid || 'system' })])
  await q(`INSERT INTO expense_items_audit (id, data) VALUES ($1, $2::jsonb)`,
    [crypto.randomUUID(), JSON.stringify({ expenseItemId: id, action: 'delete', before, createdAt: new Date().toISOString() })])
}

// product_reviews onCreate/onUpdate/onDelete → recompute avgRating + reviewCount
// on the parent product (reproduces recalcProductRating).
export async function recalcProductRating(env: Env, productId?: string) {
  if (!productId) return
  const q = sql(env)
  const rows = await q(
    `SELECT avg((data->>'rating')::numeric) AS avg, count(*)::int AS n
       FROM product_reviews WHERE product_id = $1`, [productId])
  const avg = rows[0]?.avg != null ? Math.round(Number(rows[0].avg) * 10) / 10 : 0
  const count = rows[0]?.n || 0
  await q(
    `UPDATE products
        SET data = jsonb_set(jsonb_set(data, '{avgRating}', to_jsonb($2::numeric)), '{reviewCount}', to_jsonb($3::int))
      WHERE id = $1`, [productId, avg, count])
}
