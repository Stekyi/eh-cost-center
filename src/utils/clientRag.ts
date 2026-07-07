// RAG query via the Worker endpoint. Vector search (pgvector) + generation now
// happen server-side; the browser no longer loads embeddings or computes cosine.
import { callApi } from './dataClient'

export type RagSource = { source: string; sourceId: string }
export type RagResult = { answer: string; sources: RagSource[] }

export async function clientRagQuery(query: string, topK = 5): Promise<RagResult> {
  return callApi('/api/rag/query', { body: { question: query, topK } })
}
