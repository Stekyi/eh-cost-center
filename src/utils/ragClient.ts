import { callApi } from './dataClient'

type RagRequest = {
  query: string
  topK?: number
}

export async function queryRag(payload: RagRequest) {
  // callApi auto-attaches the JWT; the RAG endpoint requires an admin token.
  return callApi('/api/rag/query', {
    body: { question: payload.query, topK: payload.topK ?? 5 },
  })
}

export default queryRag

// Convenience wrapper for existing frontend code that calls with a simple string
export async function callRag(query: string, topK = 5) {
  return queryRag({ query, topK })
}
