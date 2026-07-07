// Cron job — replaces the pubsub `updateWeeklyOrderCount` (every 24h).
// Tallies orders from the last 7 days per productId, then writes
// products.weeklyOrderCount for every product.
import { sql, type Env } from './db'

export async function runWeeklyOrderCount(env: Env): Promise<void> {
  const q = sql(env)
  const since = new Date(Date.now() - 7 * 864e5).toISOString()

  // Sum quantities per productId across the week (productIds is a JSON array on the order).
  const counts = await q(
    `SELECT pid AS product_id, count(*)::int AS n
       FROM orders o, jsonb_array_elements_text(COALESCE(o.data->'productIds','[]'::jsonb)) AS pid
      WHERE o.created_at >= $1
      GROUP BY pid`, [since])

  const map: Record<string, number> = {}
  for (const r of counts) map[r.product_id] = r.n

  const products = await q(`SELECT id FROM products`)
  for (const p of products) {
    await q(`UPDATE products SET data = jsonb_set(data, '{weeklyOrderCount}', to_jsonb($2::int)) WHERE id = $1`,
      [p.id, map[p.id] || 0])
  }
}
