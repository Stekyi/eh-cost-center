// HuggingFace embedding utility for browser
// Usage: await embedText(text, token)

export async function embedText(text: string, token: string): Promise<number[]> {
  // Use Vercel proxy in production, direct in dev
  const isProd = typeof window !== 'undefined' && window.location.hostname.endsWith('web.app');
  const url = isProd
    ? '/api/embed'
    : `https://api-inference.huggingface.co/pipeline/feature-extraction/sentence-transformers/all-MiniLM-L6-v2`;
  const body = isProd ? JSON.stringify({ text }) : JSON.stringify({ inputs: text });
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!isProd) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Embedding API error: ' + err);
  }
  const arr = await res.json();
  // arr is [ [ ...vector ] ]
  if (!Array.isArray(arr) || !Array.isArray(arr[0])) throw new Error('Unexpected embedding shape');
  return arr[0];
}
