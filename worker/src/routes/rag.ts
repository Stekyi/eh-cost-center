// RAG query (was api/rag/query.js). Replaces the JS cosine-over-200-docs scan
// with a pgvector nearest-neighbour search. Embeddings via Hugging Face,
// generation via Fireworks with HF fallback. Per-uid hourly rate limit.
import { sql, type Env } from '../db'
import { json } from '../collections'
import { getClaims, isAdmin } from '../auth'

const HF_EMBED = 'sentence-transformers/all-MiniLM-L6-v2'
const RATE_LIMIT = 60 // per hour

async function embed(env: Env, text: string): Promise<number[] | null> {
  if (!env.HUGGINGFACE_API_TOKEN) return null
  const r = await fetch(`https://api-inference.huggingface.co/pipeline/feature-extraction/${HF_EMBED}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.HUGGINGFACE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: text }),
  })
  if (!r.ok) return null
  return r.json() as Promise<number[]>
}

function redact(s: string): string {
  return s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted]').replace(/\+?\d[\d\s-]{7,}\d/g, '[redacted]')
}

export async function ragQuery(req: Request, env: Env): Promise<Response> {
  const claims = await getClaims(req, env)
  if (!isAdmin(claims) && env.RAG_ALLOW_ANON !== 'true') return json({ error: 'forbidden' }, 403)
  const uid = claims?.uid || 'anon'
  const q = sql(env)

  // Rate limit (fixed 1h window per uid).
  const [rl] = await q(`SELECT count, window_start FROM rag_rate_limits WHERE uid = $1`, [uid])
  const windowAgeMs = rl ? Date.now() - new Date(rl.window_start).getTime() : Infinity
  if (rl && windowAgeMs < 3600_000 && rl.count >= RATE_LIMIT) return json({ error: 'rate_limited' }, 429)
  if (!rl || windowAgeMs >= 3600_000) {
    await q(`INSERT INTO rag_rate_limits (uid, window_start, count) VALUES ($1, now(), 1)
             ON CONFLICT (uid) DO UPDATE SET window_start = now(), count = 1`, [uid])
  } else {
    await q(`UPDATE rag_rate_limits SET count = count + 1 WHERE uid = $1`, [uid])
  }

  const { question, topK = 5 } = await req.json().catch(() => ({} as any))
  if (!question) return json({ error: 'question required' }, 400)

  const vec = await embed(env, question)
  let context: any[]
  if (vec) {
    context = await q(
      `SELECT content, source, source_id, 1 - (embedding <=> $1::vector) AS score
         FROM rag_embeddings WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector LIMIT $2`,
      [`[${vec.join(',')}]`, Number(topK)])
  } else {
    // Fallback: naive keyword contains (matches old behavior when no embeddings).
    context = await q(
      `SELECT content, source, source_id FROM rag_embeddings WHERE content ILIKE $1 LIMIT $2`,
      [`%${question}%`, Number(topK)])
  }

  const answer = await generate(env, question, context.map((c) => c.content).filter(Boolean))
  return json({ answer: redact(answer), sources: context.map((c) => ({ source: c.source, sourceId: c.source_id })) })
}

async function generate(env: Env, question: string, ctx: string[]): Promise<string> {
  const prompt = `Answer using only this context:\n${ctx.join('\n---\n')}\n\nQuestion: ${question}`
  if (env.FIREWORKS_API_KEY) {
    const r = await fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.FIREWORKS_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'accounts/fireworks/models/llama-v3p1-8b-instruct', messages: [{ role: 'user', content: prompt }] }),
    })
    if (r.ok) { const d: any = await r.json(); return d.choices?.[0]?.message?.content || '' }
  }
  return ctx.length ? `Based on available records:\n${ctx.slice(0, 2).join('\n')}` : 'No relevant records found.'
}
