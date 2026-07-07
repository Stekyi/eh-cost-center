import React from 'react'
// ── MIGRATED to Neon compat layer ──
// Was: import { db } from '../utils/firebaseClient'
//      import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import { useLiveCollection } from '../hooks/useLiveCollection'

type Props = {
  value: string
  onChange: (v: string) => void
  required?: boolean
}

export default function CategoryCodeSelect({ value, onChange, required }: Props) {
  // onSnapshot(query(collection(db,'expenseCategories'), orderBy('code'))) → polling hook
  const { docs: cats } = useLiveCollection('expenseCategories', { orderBy: { field: 'code', dir: 'asc' } })

  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">-- select category --</option>
      {cats.map(c => (
        <option key={c.code || c.id} value={c.code}>{c.label}</option>
      ))}
    </select>
  )
}
