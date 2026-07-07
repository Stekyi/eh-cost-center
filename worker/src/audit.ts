// App-level audit stamping — replaces the Firestore wildcard triggers
// onDocCreateSetAudit / onDocUpdateSetModified. Applied by the collection
// write layer on every insert/update.
import type { Claims } from './auth'

export function actor(claims: Claims | null, fallback = 'system'): string {
  return claims?.email || claims?.uid || fallback
}

export function stampCreate(data: any, claims: Claims | null): any {
  const now = new Date().toISOString()
  return {
    ...data,
    createdAt: data.createdAt ?? now,
    createdBy: data.createdBy ?? actor(claims),
  }
}

export function stampUpdate(data: any, claims: Claims | null): any {
  const now = new Date().toISOString()
  const who = actor(claims)
  return { ...data, modifiedAt: now, modifiedBy: who, updatedBy: who }
}
