import React, { useEffect, useState } from 'react'
import { listDocs } from '../utils/dataClient'
import { variableCostPerUnit, fixedCostPerUnit, sellingPriceFromMargin } from '../utils/calc'

export default function CostPlusMeal(){
  const [productId, setProductId] = useState('')
  const [products, setProducts] = useState<any[]>([])
  const [periodMonths, setPeriodMonths] = useState(3)
  const [unitsPerMonth, setUnitsPerMonth] = useState<number>(100)
  const [variableTotal, setVariableTotal] = useState<number>(0)
  const [fixedTotal, setFixedTotal] = useState<number>(0)
  const [marginPct, setMarginPct] = useState<number>(20)
  const [autoLoad, setAutoLoad] = useState(true)
  const [freeze, setFreeze] = useState({ variable: false, fixed: false, margin: false })

  useEffect(()=>{
    async function load(){
      const arr = await listDocs('products')
      setProducts(arr)
      if(arr.length && !productId) setProductId(arr[0].id)
    }
    load()
  },[])

  useEffect(()=>{
    if(!autoLoad || !productId) return
    async function loadAverages(){
      // variable: expenseItems where costType='variable' and appliesTo includes productId or 'all'
      const expenseArr = await listDocs('expenseItems')
      let varSum = 0, fixSum = 0
      expenseArr.forEach(it=>{
        const applies = it.appliesTo || []
        const appliesToProduct = applies.includes('all') || applies.includes(productId)
        if(!appliesToProduct) return
        if(it.costType === 'variable') varSum += Number(it.amount || 0)
        else fixSum += Number(it.amount || 0)
      })
      // average per month
      setVariableTotal(varSum / Math.max(1, periodMonths))
      setFixedTotal(fixSum / Math.max(1, periodMonths))
      // units per month auto-load from orders
      const ordersArr = await listDocs('orders')
      let units = 0
      ordersArr.forEach(o=>{
        (o.items||[]).forEach((it:any)=>{ if(it.productId === productId) units += (it.qtyPackages||0) * (it.unitsPerPackage||1) })
      })
      if(units > 0) setUnitsPerMonth(units / Math.max(1, periodMonths))
    }
    loadAverages()
  },[autoLoad, productId, periodMonths])

  const vcUnit = variableCostPerUnit(variableTotal, unitsPerMonth)
  const fcUnit = fixedCostPerUnit(fixedTotal, unitsPerMonth)
  const tcUnit = (isNaN(vcUnit) || isNaN(fcUnit)) ? NaN : vcUnit + fcUnit
  const selling = sellingPriceFromMargin(tcUnit, marginPct)

  function toggleFreeze(key: 'variable'|'fixed'|'margin'){
    setFreeze(prev=> ({ ...prev, [key]: !prev[key] }))
  }

  const sectionStyle = { background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.05)', marginBottom: 16 }
  const labelStyle = { display: 'block', marginBottom: 6, fontWeight: 600, color: '#1f2937' }
  const rowStyle = { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' as const }
  const inputStyle = { width: '100%' }

  const statBox = (label:string, value:string)=> (
    <div style={{ flex: '1 1 180px', background: '#f9fafb', borderRadius: 10, padding: 12, border: '1px solid #eef2f7' }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#111827' }}>{value}</div>
    </div>
  )

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '4px 8px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Cost-Plus Calculator — Meals</h2>
        <label style={{ fontSize: 14, color: '#374151' }}>
          <input type="checkbox" checked={autoLoad} onChange={e=>setAutoLoad(e.target.checked)} style={{ marginRight: 6 }} />
          Auto-load averages
        </label>
      </div>

      <div style={sectionStyle}>
        <div style={{ ...rowStyle, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 220px' }}>
            <label htmlFor="product" style={labelStyle}>Product</label>
            <select id="product" className="select" style={inputStyle} value={productId} onChange={e=>setProductId(e.target.value)}>
              {products.map(p=> <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 0 180px' }}>
            <label htmlFor="period" style={labelStyle}>Period (months)</label>
            <input id="period" className="input" style={inputStyle} type="text" value={periodMonths} onChange={e=>{
              const val = e.target.value;
              const num = val === '' ? 1 : Number(val);
              setPeriodMonths(isNaN(num) ? periodMonths : num);
            }} />
          </div>
          <div style={{ flex: '0 0 220px' }}>
            <label htmlFor="units" style={labelStyle}>Units per month (N)</label>
            <input id="units" className="input" style={inputStyle} type="text" value={unitsPerMonth} onChange={e=>{
              const val = e.target.value;
              const num = val === '' ? 0 : Number(val);
              setUnitsPerMonth(isNaN(num) ? unitsPerMonth : num);
            }} />
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h4 style={{ margin: 0 }}>Costs (monthly averages)</h4>
          <div style={{ display: 'flex', gap: 12, fontSize: 13, color: '#374151' }}>
            <label><input type="checkbox" checked={freeze.variable} onChange={()=>toggleFreeze('variable')} style={{ marginRight: 6 }} />Lock variable</label>
            <label><input type="checkbox" checked={freeze.fixed} onChange={()=>toggleFreeze('fixed')} style={{ marginRight: 6 }} />Lock fixed</label>
            <label><input type="checkbox" checked={freeze.margin} onChange={()=>toggleFreeze('margin')} style={{ marginRight: 6 }} />Lock margin</label>
          </div>
        </div>
        <div style={rowStyle}>
          <div style={{ flex: '1 1 220px' }}>
            <label htmlFor="varTotal" style={labelStyle}>Variable total</label>
            <input id="varTotal" className="input" style={inputStyle} type="text" value={variableTotal} onChange={e=>{
              const val = e.target.value;
              const num = val === '' ? 0 : Number(val);
              setVariableTotal(isNaN(num) ? variableTotal : num);
            }} disabled={freeze.variable} />
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <label htmlFor="fixTotal" style={labelStyle}>Fixed total</label>
            <input id="fixTotal" className="input" style={inputStyle} type="text" value={fixedTotal} onChange={e=>{
              const val = e.target.value;
              const num = val === '' ? 0 : Number(val);
              setFixedTotal(isNaN(num) ? fixedTotal : num);
            }} disabled={freeze.fixed} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label htmlFor="margin" style={labelStyle}>Desired margin %</label>
            <input id="margin" className="input" style={inputStyle} type="text" value={marginPct} onChange={e=>{
              const val = e.target.value;
              const num = val === '' ? 0 : Number(val);
              setMarginPct(isNaN(num) ? marginPct : num);
            }} disabled={freeze.margin} />
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <h4 style={{ margin: '0 0 12px' }}>Results (per unit)</h4>
        <div style={{ ...rowStyle, alignItems: 'stretch' }}>
          {statBox('Variable cost / unit', isNaN(vcUnit) ? '-' : vcUnit.toFixed(2))}
          {statBox('Fixed cost / unit', isNaN(fcUnit) ? '-' : fcUnit.toFixed(2))}
          {statBox('Total cost / unit (break-even)', isNaN(tcUnit) ? '-' : tcUnit.toFixed(2))}
          {statBox(`Selling price @ ${marginPct}% margin`, isNaN(selling) ? '-' : selling.toFixed(2))}
        </div>
      </div>
    </div>
  )
}
