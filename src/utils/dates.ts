// Date coercion for the Neon backend. Firestore used to return Timestamp
// objects (with .toDate()/.seconds); the Neon compat layer returns ISO-8601
// strings. This helper accepts any of the shapes historically stored so
// display code can migrate with a single find-replace:
//   someDoc.createdAt.toDate()      → toJsDate(someDoc.createdAt)
//   new Date(x.seconds * 1000)      → toJsDate(x)
export function toJsDate(value: any): Date | null {
  if (value == null) return null
  if (value instanceof Date) return value
  if (typeof value === 'string') { const d = new Date(value); return isNaN(+d) ? null : d }
  if (typeof value === 'number') return new Date(value) // epoch ms
  // Firestore Timestamp shapes (legacy data that slipped through as objects)
  if (typeof value.toDate === 'function') return value.toDate()
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000)
  if (typeof value._seconds === 'number') return new Date(value._seconds * 1000)
  return null
}

// Convenience: formatted date string or a fallback.
export function formatDate(value: any, fallback = '-'): string {
  const d = toJsDate(value)
  return d ? d.toLocaleDateString() : fallback
}
