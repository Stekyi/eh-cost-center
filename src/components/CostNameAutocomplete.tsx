import React, { useEffect, useState } from 'react'
// ── MIGRATED to Neon compat layer ──
// Was: import { db } from '../utils/firebaseClient'
//      import { collection, getDocs, query } from 'firebase/firestore'
import { listDocs } from '../utils/dataClient'

export default function CostNameAutocomplete({ value, onChange }: { value: string, onChange: (v:string)=>void }){
  const [allNames, setAllNames] = useState<string[]>([])
  const [filter, setFilter] = useState(value||'')
  const [matches, setMatches] = useState<string[]>([])

  useEffect(()=>{
    async function load(){
      const docs = await listDocs('expenseItems')
      const set = new Set<string>()
      docs.forEach((it:any)=>{ if(it && it.name) set.add(it.name) })
      setAllNames(Array.from(set))
    }
    load()
  },[])

  useEffect(()=>{
    if(!filter) return setMatches([])
    const m = allNames.filter(n=> n.toLowerCase().includes(filter.toLowerCase())).slice(0,10)
    setMatches(m)
  },[filter, allNames])

  return (
    <div style={{ position: 'relative' }}>
      <input className="input" value={filter} onChange={e=>{ setFilter(e.target.value); onChange(e.target.value) }} placeholder="cost name" />
      {matches.length>0 && (
        <div style={{ position: 'absolute', background: '#fff', border: '1px solid #ddd', zIndex: 10, width: '100%' }}>
          {matches.map(m=> <div key={m} style={{ padding: 6, cursor: 'pointer' }} onClick={()=>{ onChange(m); setFilter(m); setMatches([]) }}>{m}</div>)}
        </div>
      )}
    </div>
  )
}
