// Polling replacement for Firestore onSnapshot(). Refetches on an interval and
// on window focus, giving near-live updates on shared screens without the
// WebSocket infrastructure Firestore provided.
//
//   Firestore:
//     useEffect(() => onSnapshot(query(collection(db,'orders'), orderBy('createdAt','desc')),
//                                s => setOrders(s.docs.map(d => ({ id:d.id, ...d.data() })))), [])
//   becomes:
//     const { docs: orders } = useLiveCollection('orders', { orderBy: { field: 'createdAt', dir: 'desc' } })
import { useCallback, useEffect, useRef, useState } from 'react'
import { listDocs, type Doc, type QuerySpec } from '../utils/dataClient'

const DEFAULT_INTERVAL_MS = 15_000

export interface LiveResult {
  docs: Doc[]
  loading: boolean
  error: Error | null
  refresh: () => void
}

export function useLiveCollection(
  collection: string,
  spec?: QuerySpec,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): LiveResult {
  const [docs, setDocs] = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  // Stringify the spec so the effect re-runs only on real query changes, not
  // on every render's new object identity.
  const specKey = JSON.stringify(spec ?? null)
  const mounted = useRef(true)

  const fetchNow = useCallback(async () => {
    try {
      const rows = await listDocs(collection, spec)
      if (mounted.current) { setDocs(rows); setError(null) }
    } catch (e: any) {
      if (mounted.current) setError(e instanceof Error ? e : new Error(String(e)))
    } finally {
      if (mounted.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, specKey])

  useEffect(() => {
    mounted.current = true
    setLoading(true)
    fetchNow()
    const timer = setInterval(fetchNow, intervalMs)
    const onFocus = () => fetchNow()
    window.addEventListener('focus', onFocus)
    return () => {
      mounted.current = false
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchNow, intervalMs])

  return { docs, loading, error, refresh: fetchNow }
}
