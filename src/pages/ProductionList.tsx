import React, { useEffect, useState } from 'react'
import { listDocs, getDocById } from '../utils/dataClient'
import { toJsDate } from '../utils/dates'
import type { GridColDef } from '@mui/x-data-grid'
import ResponsiveDataGrid from '../components/ResponsiveDataGrid'

export default function ProductionList(){
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [totals, setTotals] = useState<Record<string,number>>({})
  const [namedTotals, setNamedTotals] = useState<Array<{ productId: string, name: string, packages: number }>>([])

  const rows = namedTotals.map((r) => ({ id: r.productId, ...r }))

  const columns = [
    { field: 'name', headerName: 'Product', flex: 1, minWidth: 200 },
    { field: 'packages', headerName: 'Packages', width: 140 },
  ] as GridColDef<any>[]

  async function generate(){
    const startTs = start ? new Date(start) : new Date(0)
    const endTs = end ? new Date(end) : new Date()
    const orders = await listDocs('orders')
    const agg: Record<string,number> = {}
    orders.forEach(o=>{
      const created = toJsDate(o.createdAt)
      if(created && created >= startTs && created <= endTs){
        (o.items||[]).forEach((it:any)=>{
          agg[it.productId] = (agg[it.productId]||0) + (it.qtyPackages || 0)
        })
      }
    })
    setTotals(agg)
    // resolve product names
    const arr: Array<{ productId: string, name: string, packages: number }> = []
    for(const pid of Object.keys(agg)){
      let name = pid
      try{
        const p = await getDocById('products', pid)
        if(p) name = p.name || name
      }catch(e){}
      arr.push({ productId: pid, name, packages: agg[pid] })
    }
    setNamedTotals(arr)
  }

  function exportCsv(){
    const rows = [['productId','name','packages'], ...namedTotals.map(r=> [r.productId, r.name, String(r.packages)])]
    const csv = rows.map(r=> r.map(c=> '"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `production-${start||'start'}-${end||'end'}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Production List</h2>
        <div className="row">
          <div>
            <span className="section-title">Start</span>
            <input className="input" type="date" value={start} onChange={e=>setStart(e.target.value)} />
          </div>
          <div>
            <span className="section-title">End</span>
            <input className="input" type="date" value={end} onChange={e=>setEnd(e.target.value)} />
          </div>
          <button className="btn btn-primary" onClick={generate}>Generate</button>
          <button className="btn" onClick={exportCsv} disabled={namedTotals.length===0} style={{ marginLeft: 8 }}>Export CSV</button>
        </div>
      </div>
      <div className="card">
        <ResponsiveDataGrid
          rows={rows}
          columns={columns}
          cardTitle={(row: any) => row.name}
          cardFields={[{ label: 'Packages', value: (row: any) => row.packages }]}
        />
      </div>
    </div>
  )
}
