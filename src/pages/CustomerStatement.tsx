import React, { useEffect, useMemo, useState } from 'react'
// ── MIGRATED to Neon compat layer ──
import { getDocById, updateDocById } from '../utils/dataClient'
import { useLiveCollection } from '../hooks/useLiveCollection'
import { toJsDate } from '../utils/dates'
import ResponsiveDataGrid from '../components/ResponsiveDataGrid'
import type { GridColDef } from '@mui/x-data-grid'
import { Link, useNavigate } from 'react-router-dom'
import Autocomplete from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import { TableContainer, Table, TableHead, TableBody, TableRow, TableCell, Paper } from '@mui/material'
import { toLabelsText } from '../utils/customerSegments'

function money(n: number) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function dateOnly(v: any) {
  const d = toJsDate(v)
  return d ? d.toISOString().split('T')[0] : '-'
}

export default function CustomerStatement() {
  const navigate = useNavigate()
  // onSnapshot → polling hooks.
  const { docs: customers } = useLiveCollection('customers')
  const { docs: productDocs } = useLiveCollection('products')
  const { docs: categoryRows } = useLiveCollection('customerCategories')
  const { docs: allergyRows } = useLiveCollection('customerAllergies')
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  const productsById = useMemo(() => {
    const map: Record<string, any> = {}
    productDocs.forEach((d: any) => { map[d.id] = d })
    return map
  }, [productDocs])

  // Orders for the selected customer (client-side sort + date filter below).
  const { docs: ordersLive, refresh: refreshOrders } = useLiveCollection(
    'orders',
    { where: [{ field: 'customerId', op: '==', value: selectedCustomerId || '__none__' }] },
  )
  const ordersRaw = useMemo(() => {
    const arr = [...ordersLive]
    arr.sort((a, b) => {
      const aTime = toJsDate(a.createdAt)?.getTime() || 0
      const bTime = toJsDate(b.createdAt)?.getTime() || 0
      return bTime - aTime // Most recent first
    })
    return arr
  }, [ordersLive])

  // Load state from localStorage on mount
  useEffect(() => {
    const savedCustomerId = localStorage.getItem('customerStatement_selectedCustomerId')
    const savedFromDate = localStorage.getItem('customerStatement_fromDate')
    const savedToDate = localStorage.getItem('customerStatement_toDate')
    
    if (savedCustomerId) setSelectedCustomerId(savedCustomerId)
    if (savedFromDate) setFromDate(savedFromDate)
    if (savedToDate) setToDate(savedToDate)
  }, [])

  // Save state to localStorage when it changes
  useEffect(() => {
    if (selectedCustomerId) {
      localStorage.setItem('customerStatement_selectedCustomerId', selectedCustomerId)
    } else {
      localStorage.removeItem('customerStatement_selectedCustomerId')
    }
  }, [selectedCustomerId])

  useEffect(() => {
    localStorage.setItem('customerStatement_fromDate', fromDate)
  }, [fromDate])

  useEffect(() => {
    localStorage.setItem('customerStatement_toDate', toDate)
  }, [toDate])

  // Set selectedCustomer when customers are loaded and selectedCustomerId exists
  useEffect(() => {
    if (selectedCustomerId && customers.length > 0) {
      const customer = customers.find(c => c.id === selectedCustomerId)
      if (customer) {
        setSelectedCustomer(customer)
      }
    }
  }, [selectedCustomerId, customers])

  // Load customer details for the selected customer (orders come from useLiveCollection above).
  useEffect(() => {
    if (!selectedCustomerId) {
      setSelectedCustomer(null)
      return
    }
    getDocById('customers', selectedCustomerId).then((c) => {
      if (c) {
        setSelectedCustomer(c)
      }
    })
  }, [selectedCustomerId])

  // Enrich orders with computed subtotal and filter by date
  const [orders, setOrders] = useState<any[]>([])
  useEffect(() => {
    ;(async () => {
      const enriched = await Promise.all(
        ordersRaw.map(async (o: any) => {
          const subtotal = (o.items || []).reduce((s: number, it: any) => {
            const pid = String(it.productId || '')
            const p = pid ? productsById[pid] : null
            const unit = p ? Number(p.price ?? p.unitCost ?? 0) : 0
            const qty = Number(it.qtyPackages ?? it.qty ?? 0)
            return s + unit * qty
          }, 0)
          return {
            ...o,
            subtotal,
            customerName: selectedCustomer?.name || '-',
            categoryCodes: selectedCustomer?.categoryCodes || [],
            allergyCodes: selectedCustomer?.allergyCodes || [],
          }
        })
      )
      // Filter by date range
      let filtered = enriched
      if (fromDate) {
        const from = new Date(fromDate)
        filtered = filtered.filter(o => {
          const created = toJsDate(o.createdAt)
          return created ? created >= from : false
        })
      }
      if (toDate) {
        const to = new Date(toDate)
        to.setHours(23, 59, 59, 999) // End of day
        filtered = filtered.filter(o => {
          const created = toJsDate(o.createdAt)
          return created ? created <= to : false
        })
      }
      setOrders(filtered)
    })()
  }, [ordersRaw, productsById, fromDate, toDate, selectedCustomer])

  const categoryLabelMap = useMemo(
    () => Object.fromEntries(categoryRows.map((r) => [String(r.code), String(r.label || r.code)])),
    [categoryRows],
  )
  const allergyLabelMap = useMemo(
    () => Object.fromEntries(allergyRows.map((r) => [String(r.code), String(r.label || r.code)])),
    [allergyRows],
  )

  const handleProcessRowUpdate = async (newRow: any, oldRow: any) => {
    // Validation: amount paid must be at least the subtotal (delivery = amountPaid - subtotal >= 0)
    const amountPaid = Number(newRow.amountPaid || 0)
    const subtotal = Number(newRow.subtotal || 0)
    if (amountPaid < subtotal) {
      throw new Error('Amount paid must be at least the subtotal.')
    }
    // Persist via the Neon compat layer
    await updateDocById('orders', newRow.id, {
      amountPaid: amountPaid,
    })
    refreshOrders()
    return newRow
  }

  const columns: GridColDef[] = [
    {
      field: 'id',
      headerName: 'Order',
      width: 220,
      renderCell: (params) => <Link to={`/orders/${params.row.id}`}>{String(params.row.id)}</Link>,
    },
    {
      field: 'orderDate',
      headerName: 'Order Date',
      width: 130,
      valueGetter: (_v, row: any) => dateOnly(row.createdAt),
    },
    { field: 'customerName', headerName: 'Customer', flex: 1, minWidth: 180 },
    { field: 'subtotal', headerName: 'Subtotal', width: 120, valueFormatter: (v) => money(Number(v ?? 0)) },
    {
      field: 'amountPaid',
      headerName: 'Amount Paid',
      width: 120,
      editable: true,
      valueFormatter: (v) => money(Number(v ?? 0)),
    },
    {
      field: 'delivery',
      headerName: 'Delivery Fee',
      width: 120,
      valueGetter: (_v, row: any) => Math.max(0, (row.amountPaid || 0) - (row.subtotal || 0)),
      valueFormatter: (v) => money(Number(v ?? 0)),
    },
    { field: 'statusLabel', headerName: 'Status', width: 120, valueGetter: (_v, row: any) => (row.delivered ? 'Delivered' : row.paid ? 'Paid' : Number(row.amountPaid || 0) > 0 ? 'Part-paid' : 'Booked') },
  ]

  const totalSubtotal = orders.reduce((sum, o) => sum + (o.subtotal || 0), 0)
  const totalPaid = orders.reduce((sum, o) => sum + (o.amountPaid || 0), 0)
  const totalDelivery = orders.reduce((sum, o) => sum + Math.max(0, (o.amountPaid || 0) - (o.subtotal || 0)), 0)
  const orderCount = orders.length
  const totalNet = totalPaid - totalDelivery

  const getExpandedContent = (row: any) => {
    if (!row.items || row.items.length === 0) return null
    return (
      <TableContainer component={Paper} sx={{ mt: 1, mb: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Product Name</TableCell>
              <TableCell align="right">Quantity</TableCell>
              <TableCell align="right">Unit Cost</TableCell>
              <TableCell align="right">Total Cost</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {row.items.map((item: any, index: number) => {
              const product = productsById[item.productId]
              const productName = product ? product.name || 'Unknown' : 'Unknown'
              const qty = item.qtyPackages || item.qty || 0
              const unitCost = product ? (product.price || product.unitCost || 0) : 0
              const total = qty * unitCost
              return (
                <TableRow key={index}>
                  <TableCell>{productName}</TableCell>
                  <TableCell align="right">{qty}</TableCell>
                  <TableCell align="right">{unitCost.toFixed(2)}</TableCell>
                  <TableCell align="right">{total.toFixed(2)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ marginBottom: 0 }}>Customer Insight</h2>
          <div style={{ color: 'var(--text-light)', fontSize: 13 }}>Statement + customer profile context</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <Autocomplete
            options={customers}
            sx={{ minWidth: 320, flex: '1 1 320px' }}
            getOptionLabel={(option) => `${option.name || ''} ${option.city ? `(${option.city})` : ''} ${option.telephone1 || option.telephone || option.phone ? `- ${option.telephone1 || option.telephone || option.phone}` : ''}`.trim()}
            value={selectedCustomer}
            onChange={(_event, newValue) => {
              setSelectedCustomer(newValue)
              setSelectedCustomerId(newValue ? newValue.id : null)
            }}
            renderInput={(params) => <TextField {...params} label="Select Customer" variant="outlined" size="small" />}
          />
          <input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} placeholder="From Date" style={{ width: 150 }} />
          <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} placeholder="To Date" style={{ width: 150 }} />
          <button
            className="btn"
            type="button"
            onClick={() => {
              setFromDate('')
              setToDate('')
            }}
          >
            Clear Dates
          </button>
        </div>
      </div>

      {selectedCustomer && (
        <div className="card" style={{ marginBottom: 0 }}>
          <h3 style={{ marginBottom: 12 }}>Customer Profile</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <div><strong>Name:</strong> {selectedCustomer.name || 'N/A'}</div>
            <div><strong>City:</strong> {selectedCustomer.city || 'N/A'}</div>
            <div><strong>Phone:</strong> {[selectedCustomer.telephone1, selectedCustomer.telephone2, selectedCustomer.telephone, selectedCustomer.phone].filter(Boolean).join(' / ') || 'N/A'}</div>
            <div><strong>Address:</strong> {[selectedCustomer.deliveryAddress1, selectedCustomer.deliveryAddress2].filter(Boolean).join(', ') || 'N/A'}</div>
            <div style={{ gridColumn: '1 / -1' }}><strong>Categories:</strong> {toLabelsText(selectedCustomer.categoryCodes, categoryLabelMap)}</div>
            <div style={{ gridColumn: '1 / -1' }}><strong>Allergies:</strong> {toLabelsText(selectedCustomer.allergyCodes, allergyLabelMap)}</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 0 }}>
        <h3 style={{ marginBottom: 12 }}>Summary</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <div className="card" style={{ padding: 12 }}><div style={{ color: 'var(--text-light)', fontSize: 12 }}>Total Orders</div><div style={{ fontWeight: 700, fontSize: 20 }}>{orderCount}</div></div>
          <div className="card" style={{ padding: 12 }}><div style={{ color: 'var(--text-light)', fontSize: 12 }}>Subtotal</div><div style={{ fontWeight: 700, fontSize: 20 }}>{money(totalSubtotal)}</div></div>
          <div className="card" style={{ padding: 12 }}><div style={{ color: 'var(--text-light)', fontSize: 12 }}>Amount Paid</div><div style={{ fontWeight: 700, fontSize: 20 }}>{money(totalPaid)}</div></div>
          <div className="card" style={{ padding: 12 }}><div style={{ color: 'var(--text-light)', fontSize: 12 }}>Delivery Fees</div><div style={{ fontWeight: 700, fontSize: 20 }}>{money(totalDelivery)}</div></div>
          <div className="card" style={{ padding: 12 }}><div style={{ color: 'var(--text-light)', fontSize: 12 }}>Net Paid</div><div style={{ fontWeight: 700, fontSize: 20 }}>{money(totalNet)}</div></div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <h3 style={{ marginBottom: 12 }}>Order Statement</h3>
        <ResponsiveDataGrid
          rows={orders}
          columns={columns}
          processRowUpdate={handleProcessRowUpdate}
          onProcessRowUpdateError={(error) => alert(error.message)}
          cardTitle={(row: any) => `Order ${row.id}`}
          cardFields={[
            { label: 'Order Date', value: (row: any) => dateOnly(row.createdAt) },
            { label: 'Customer', value: (row: any) => row.customerName },
            { label: 'Categories', value: (row: any) => toLabelsText(row.categoryCodes, categoryLabelMap) },
            { label: 'Allergies', value: (row: any) => toLabelsText(row.allergyCodes, allergyLabelMap) },
            { label: 'Subtotal', value: (row: any) => money(Number(row.subtotal || 0)) },
            { label: 'Amount Paid', value: (row: any) => money(Number(row.amountPaid || 0)) },
            { label: 'Delivery', value: (row: any) => money(Number(row.delivery || 0)) },
            { label: 'Status', value: (row: any) => (row.delivered ? 'Delivered' : row.paid ? 'Paid' : 'Booked') },
          ]}
          getExpandedContent={getExpandedContent}
          onRowOpen={(row: any) => navigate(`/orders/${row.id}`)}
        />
      </div>
    </div>
  )
}
