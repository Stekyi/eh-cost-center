import React, { useEffect, useState } from 'react'
// ── MIGRATED to Neon compat layer ──
// Was: import { db, auth } from '../utils/firebaseClient'
//      import { collection, addDoc, onSnapshot, getDocs, deleteDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { createDoc, updateDocById, deleteDocById, listDocs } from '../utils/dataClient'
import { useLiveCollection } from '../hooks/useLiveCollection'
import { toJsDate } from '../utils/dates'
import CategoryCodeSelect from '../components/CategoryCodeSelect'
import Modal from '../components/Modal'
import { Tooltip, Snackbar, Alert, useTheme, useMediaQuery, IconButton, CircularProgress, Drawer } from '@mui/material'
import { useConfirmDialog } from '../hooks/useConfirmDialog'
import { useRole } from '../utils/RoleContext'
import AddIcon from '@mui/icons-material/Add'
import FilterListIcon from '@mui/icons-material/FilterList'
import ClearIcon from '@mui/icons-material/Clear'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
// replaced CostNameAutocomplete by using category as the expense name
import type { GridColDef } from '@mui/x-data-grid'
import ResponsiveDataGrid from '../components/ResponsiveDataGrid'

export default function CostLedger(){
  const { docs: items, refresh } = useLiveCollection('expenseItems')
  const { docs: categories } = useLiveCollection('expenseCategories')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState<number>(0)
  const [appliesTo, setAppliesTo] = useState<string>('all')
  const [products, setProducts] = useState<any[]>([])
  const [valueDate, setValueDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [narration, setNarration] = useState('')
  const [categoryCode, setCategoryCode] = useState('')
  const [toastOpen, setToastOpen] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const [toastSeverity, setToastSeverity] = useState<'success'|'info'|'warning'|'error'>('success')
  const [filterType, setFilterType] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [search, setSearch] = useState<string>('')
  const [editing, setEditing] = useState<any | null>(null)
  const [showFiltersMobile, setShowFiltersMobile] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastInsertedId, setLastInsertedId] = useState<string | null>(null)
  const [lastAddSuccess, setLastAddSuccess] = useState(false)
  const [showAddDrawer, setShowAddDrawer] = useState(false)
  const theme = useTheme()
  const isSmUp = useMediaQuery(theme.breakpoints.up('sm'))
  const { confirm: confirmDialog, ConfirmElement } = useConfirmDialog()
  const role = useRole()
  const canDelete = role === 'admin'

  const rows = items.filter((it) => !!it?.id)

  const columns = [
    {
      field: 'valueDate',
      headerName: 'Date',
      width: 120,
      valueGetter: (_v: any, row: any) => {
        const d = toJsDate(row.valueDate)
        return d ? d.toLocaleDateString() : '-'
      },
    },
    // show category as primary label instead of free-text name
    {
      field: 'amount',
      headerName: 'Amount',
      width: 120,
      valueGetter: (_v: any, row: any) => row.amount ?? '-',
    },
    { field: 'costType', headerName: 'Type', width: 120, valueGetter: (_v: any, row: any) => getCategoryType(row.categoryCode) },
    // 'Applies To' column removed to reduce horizontal width
    {
      field: 'narration',
      headerName: 'Narration',
      flex: 1,
      minWidth: 160,
      valueGetter: (_v: any, row: any) => row.narration || '-',
    },
    {
      field: 'categoryCode',
      headerName: 'Category',
      width: 180,
      renderCell: (params: any) => (
        <Tooltip title={params.row?.categoryCode || ''}>
          <span>{getCategoryLabel(params.row?.categoryCode)}</span>
        </Tooltip>
      ),
    },
      {
        field: 'actions',
        headerName: 'Actions',
        width: 160,
        sortable: false,
        filterable: false,
        renderCell: (params: any) => (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" type="button" onClick={(e) => { e.stopPropagation(); openEdit(params.row) }}>Edit</button>
            {canDelete && <button className="btn btn-danger" type="button" onClick={(e) => { e.stopPropagation(); removeExpense(params.row.id) }}>Delete</button>}
          </div>
        ),
      },
  ] as GridColDef<any>[]

  useEffect(()=>{
    async function loadProducts(){
      const arr = await listDocs('products')
      setProducts(arr)
    }
    loadProducts()
  },[])

  function getCategoryLabel(code?: string){
    if(!code) return '-'
    const c = categories.find(x => (x.code || '') === code)
    return c ? c.label : code
  }

  function getCategoryType(code?: string){
    if(!code) return 'variable'
    const c = categories.find(x => (x.code || '') === code)
    return c ? (c.type || 'variable') : 'variable'
  }

  function showToast(message: string, severity: 'success'|'info'|'warning'|'error' = 'info'){
    setToastMsg(message)
    setToastSeverity(severity)
    setToastOpen(true)
  }

  function openEdit(row: any){
    setEditing(row)
    // derive name from category for display/storage
    setName(getCategoryLabel(row.categoryCode) || '')
    setAmount(row.amount || 0)
    setAppliesTo(Array.isArray(row.appliesTo) ? (row.appliesTo[0] || 'all') : 'all')
    setValueDate((() => { const d = toJsDate(row.valueDate); return d ? d.toISOString().split('T')[0] : new Date().toISOString().split('T')[0] })())
    setNarration(row.narration || '')
    setCategoryCode(row.categoryCode || '')
    showToast('Edit opened', 'info')
  }

  async function removeExpense(id: string){
    if(!(await confirmDialog('Delete this expense? This cannot be undone.', 'Confirm Delete'))) return
    try{
      await deleteDocById('expenseItems', id)
      showToast('Expense deleted', 'success')
      refresh()
    }catch(err:any){ console.error('removeExpense err', err); showToast(err?.message || 'Failed to delete', 'error') }
  }

  async function saveEdit(e?:React.FormEvent){
    if(e) e.preventDefault()
    if(!editing) return
    if(!categoryCode){ showToast('Category is required','warning'); return }
    if(!narration.trim()){ showToast('Narration is required','warning'); return }
    if(!valueDate){ showToast('Date is required','warning'); return }
    if(!amount || Number(amount) <= 0){ showToast('Amount must be greater than zero','warning'); return }
    try{
      setSaving(true)
      await updateDocById('expenseItems', editing.id, { name: getCategoryLabel(categoryCode) || '', amount: Number(amount), costType: getCategoryType(categoryCode), appliesTo: appliesTo === 'all' ? ['all'] : [appliesTo], valueDate: new Date(valueDate), narration, categoryCode })
      setEditing(null)
      setName(''); setAmount(0); setAppliesTo('all'); setValueDate(new Date().toISOString().split('T')[0]); setNarration(''); setCategoryCode('')
      showToast('Expense updated', 'success')
      refresh()
    }catch(err:any){ console.error('saveEdit err', err); showToast(err?.message || 'Failed to save', 'error') }
    finally{ setSaving(false) }
  }

  async function create(e?:React.FormEvent){
    if(e) e.preventDefault()
    
    // Check for duplicate expense
    const appliesToValue = appliesTo === 'all' ? 'all' : appliesTo
    const duplicate = items.find(item => {
      const itemAppliesTo = Array.isArray(item.appliesTo) ? (item.appliesTo[0] || 'all') : 'all'
      const itemDateObj = toJsDate(item.valueDate)
      const itemDate = itemDateObj ? itemDateObj.toISOString().split('T')[0] : ''
      return item.name === getCategoryLabel(categoryCode) && 
             itemDate === valueDate && 
             item.amount === Number(amount) && 
             itemAppliesTo === appliesToValue && 
             (item.narration || '') === narration
    })

    if(!categoryCode){ showToast('Category is required','warning'); return }
    if(!narration.trim()){ showToast('Narration is required','warning'); return }
    if(!valueDate){ showToast('Date is required','warning'); return }
    if(!amount || Number(amount) <= 0){ showToast('Amount must be greater than zero','warning'); return }
    try{
      setSaving(true)
      const ref = await createDoc('expenseItems', { name: getCategoryLabel(categoryCode) || '', amount: Number(amount), costType: getCategoryType(categoryCode), appliesTo: appliesTo === 'all' ? ['all'] : [appliesTo], valueDate: new Date(valueDate), narration, categoryCode, date: new Date() })
      showToast('Expense added', 'success')
      setName(''); setAmount(0); setAppliesTo('all'); setValueDate(new Date().toISOString().split('T')[0]); setNarration(''); setCategoryCode('')
      setLastInsertedId(ref.id)
      setLastAddSuccess(true)
      setTimeout(() => { setLastAddSuccess(false); setLastInsertedId(null) }, 3000)
      setShowAddDrawer(false)
      refresh()
    }catch(err:any){ console.error('create expense err', err); showToast(err?.message || 'Failed to add expense','error') }
    finally{ setSaving(false) }
  }

  // Filtering and search
  const filteredRows = rows.filter(r => {
    // type filter
    if(filterType && r.costType !== filterType) return false
    // date range
    if(startDate){ const d = toJsDate(r.valueDate); if(d && new Date(startDate) > d) return false }
    if(endDate){ const d = toJsDate(r.valueDate); if(d && new Date(endDate) < d) return false }
    // search: amount numeric or narration text
    if(search){
      const q = search.trim().toLowerCase()
      const num = Number(q)
      if(!isNaN(num) && q !== ''){
        if(String(r.amount).indexOf(String(num)) === -1) return false
      } else {
        const narr = (r.narration || '').toLowerCase()
        if(narr.indexOf(q) === -1 && (r.name || '').toLowerCase().indexOf(q) === -1) return false
      }
    }
    return true
  })

  const totalFiltered = filteredRows.reduce((s, it) => s + (Number(it.amount || 0)), 0)
  const totalFilteredFmt = totalFiltered.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <>
    <div className="grid">
      <div className="card">
        <h2>Expense Items</h2>
        {!isSmUp ? (
          <div style={{ marginBottom: 12 }}>
            <button type="button" className="btn btn-primary" onClick={() => setShowAddDrawer(true)}>
              <AddIcon style={{ verticalAlign: 'middle', marginRight: 8 }} />Add Expense
            </button>
          </div>
        ) : null}

        {/* Inline form for desktop; mobile uses drawer below */}
        {isSmUp && (
          <form onSubmit={(e)=> editing ? saveEdit(e) : create(e)} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: '20px' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: '1', minWidth: '220px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Category</label>
                <CategoryCodeSelect value={categoryCode} onChange={setCategoryCode} required />
              </div>
              <div style={{ flex: '0 0 120px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Amount</label>
                <input id="amount" className="input" type="text" value={amount} onChange={e=>{
                  const val = e.target.value;
                  const num = val === '' ? 0 : Number(val);
                  setAmount(isNaN(num) ? amount : num);
                }} />
              </div>
              <div style={{ flex: '0 0 130px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Date</label>
                <input id="valueDate" className="input" type="date" value={valueDate} onChange={e=>setValueDate(e.target.value)} />
              </div>
              <div style={{ flex: '0 0 150px' }}>
                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Applies To</label>
                <select id="appliesTo" className="select" value={appliesTo} onChange={e=>setAppliesTo(e.target.value)}>
                  <option value="all">All products</option>
                  {products.map(p=> (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="narration" style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Narration</label>
                <input id="narration" className="input" type="text" value={narration} onChange={e=>setNarration(e.target.value)} placeholder="Description of expense" />
              </div>
              <div style={{ flex: '0 0 120px', alignSelf: 'flex-end' }}>
                <button type="submit" className="btn btn-primary" style={{ marginBottom: '0' }} disabled={saving}>{saving ? <CircularProgress size={18} color="inherit" /> : (editing ? 'Save' : (lastAddSuccess ? <CheckCircleIcon className="success-icon-anim" /> : 'Add'))}</button>
              </div>
            </div>
          </form>
        )}

        {/* Mobile drawer form */}
        <Drawer anchor="bottom" open={showAddDrawer} onClose={() => setShowAddDrawer(false)}>
          <div style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Add Expense</h3>
            <form onSubmit={(e)=>{ create(e); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label>Category</label>
                <CategoryCodeSelect value={categoryCode} onChange={setCategoryCode} required />
              </div>
              <div>
                <label>Amount</label>
                <input className="input" type="text" value={amount} onChange={e=>{
                  const val = e.target.value;
                  const num = val === '' ? 0 : Number(val);
                  setAmount(isNaN(num) ? amount : num);
                }} />
              </div>
              <div>
                <label>Date</label>
                <input className="input" type="date" value={valueDate} onChange={e=>setValueDate(e.target.value)} />
              </div>
              <div>
                <label>Applies To</label>
                <select className="select" value={appliesTo} onChange={e=>setAppliesTo(e.target.value)}>
                  <option value="all">All products</option>
                  {products.map(p=> (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Narration</label>
                <input className="input" type="text" value={narration} onChange={e=>setNarration(e.target.value)} placeholder="Description of expense" />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? <CircularProgress size={18} color="inherit" /> : 'Add'}</button>
                <button className="btn" type="button" onClick={()=>setShowAddDrawer(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </Drawer>
      </div>
      <div className="card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
          {!isSmUp && (
            <IconButton size="small" onClick={()=>setShowFiltersMobile(v=>!v)} title="Show filters">
              <FilterListIcon />
            </IconButton>
          )}
          <div style={{ display: isSmUp || showFiltersMobile ? 'flex' : 'none', gap:12, alignItems: 'flex-end' }}>
          <div>
            <label>Type</label>
            <select className="select" value={filterType} onChange={e=>setFilterType(e.target.value)}>
              <option value="">All</option>
              <option value="variable">Variable</option>
              <option value="fixed">Fixed</option>
            </select>
          </div>
          <div>
            <label>Start Date</label>
            <input className="input" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} />
          </div>
          <div>
            <label>End Date</label>
            <input className="input" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Search (amount or narration)</label>
            <input className="input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="search amount or narration" />
          </div>
          <div>
            <label style={{ visibility: 'hidden' }}>clear</label>
            <button className="btn" onClick={()=>{ setFilterType(''); setStartDate(''); setEndDate(''); setSearch(''); showToast('Filters cleared','info') }}>
              <ClearIcon style={{ verticalAlign: 'middle', marginRight: 6 }} />Clear Filters
            </button>
          </div>
          </div>
          <div style={{ marginLeft: 'auto', paddingTop: 8 }}><strong>Total: {totalFilteredFmt}</strong></div>
        </div>
        <ResponsiveDataGrid
          rows={filteredRows}
          columns={columns}
          cardTitle={(row: any) => getCategoryLabel(row.categoryCode)}
          cardFields={[
            {
              label: 'Date',
              value: (row: any) => {
                const d = toJsDate(row.valueDate)
                return d ? d.toLocaleDateString() : '-'
              },
            },
            { label: 'Amount', value: (row: any) => row.amount ?? '-' },
            { label: 'Type', value: (row: any) => getCategoryType(row.categoryCode) },
            { label: 'Narration', value: (row: any) => row.narration || '-' },
            { label: 'Category', value: (row: any) => getCategoryLabel(row.categoryCode) },
          ]}
          highlightRowId={lastInsertedId}
          onRowOpen={(row: any) => openEdit(row)}
        />
      </div>
    </div>
    {editing && (
      <Modal open={!!editing} onClose={()=>setEditing(null)}>
        <h2>Edit Expense</h2>
        <form onSubmit={saveEdit}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 150px 120px', gap: 8 }}>
            <div>
              <label>Amount</label>
              <input className="input" type="text" value={amount} onChange={e=>{
                const val = e.target.value;
                const num = val === '' ? 0 : Number(val);
                setAmount(isNaN(num) ? amount : num);
              }} />
            </div>
            <div>
              <label>Date</label>
              <input className="input" type="date" value={valueDate} onChange={e=>setValueDate(e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Category</label>
              <CategoryCodeSelect value={categoryCode} onChange={setCategoryCode} required />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Narration</label>
              <input className="input" value={narration} onChange={e=>setNarration(e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <button className="btn btn-primary" type="submit">Save</button>
            </div>
          </div>
        </form>
      </Modal>
    )}
    {ConfirmElement}
    <Snackbar open={toastOpen} autoHideDuration={4000} onClose={()=>setToastOpen(false)}>
      <Alert onClose={()=>setToastOpen(false)} severity={toastSeverity} sx={{ width: '100%' }}>
        {toastMsg}
      </Alert>
    </Snackbar>
    </>
  )
}
