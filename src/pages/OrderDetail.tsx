import React, { useEffect, useState, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { listDocs, getDocById, updateDocById, callApi, ApiError } from '../utils/dataClient'
import { toJsDate } from '../utils/dates'
import { downloadInvoicePdf, shareOrderSummaryImage } from '../utils/pdf'
import { toLabelsText } from '../utils/customerSegments'
import {
  useTheme,
  useMediaQuery,
  Box,
  Paper,
  Typography,
  Button,
  Drawer,
  Fab,
  TextField,
  CircularProgress,
  Chip,
  Divider,
  IconButton,
} from '@mui/material'
import PaymentIcon from '@mui/icons-material/Payment'
import LocalShippingIcon from '@mui/icons-material/LocalShipping'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import IosShareIcon from '@mui/icons-material/IosShare'
import AddCircleIcon from '@mui/icons-material/AddCircle'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import { useSnackbar } from '../hooks/useSnackbar'
import { useConfirmDialog } from '../hooks/useConfirmDialog'

// Canonical line total — MUST match the Worker's markPaid/edit computation
// (unitCost × unitsPerPackage × qtyPackages) or the balance check rejects the
// payment. Falls back to `price`/`qty` for older data shapes.
function lineTotal(it: any): number {
  const p = it?.product || {}
  const unit = Number(p.unitCost ?? p.price ?? 0)
  const upp = Number(p.unitsPerPackage ?? 1)
  const qty = Number(it?.qtyPackages ?? it?.qty ?? 0)
  return unit * upp * qty
}

export default function OrderDetail() {
  const DELETE_PASSCODE = '2018'
  const { id } = useParams()
  const navigate = useNavigate()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const { showSuccess, showError, SnackbarElement } = useSnackbar()
  const { confirm, ConfirmElement } = useConfirmDialog()

  const [order, setOrder] = useState<any>(null)
  const [customer, setCustomer] = useState<any>(null)
  const [amountPaid, setAmountPaid] = useState<number>(0)
  const [deliveryFee, setDeliveryFee] = useState<number>(0)
  const [valueDate, setValueDate] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [delivering, setDelivering] = useState(false)
  const [deliveredBy, setDeliveredBy] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [customers, setCustomers] = useState<any[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [categoryRows, setCategoryRows] = useState<any[]>([])
  const [allergyRows, setAllergyRows] = useState<any[]>([])
  const [editCustomerId, setEditCustomerId] = useState('')
  const [editCustomerInstructions, setEditCustomerInstructions] = useState('')
  const [editItems, setEditItems] = useState<any[]>([])
  const [error, setError] = useState('')

  // Mobile bottom sheet state
  const [payDrawerOpen, setPayDrawerOpen] = useState(false)
  const [deliverDrawerOpen, setDeliverDrawerOpen] = useState(false)

  const invoiceRef = useRef<HTMLDivElement | null>(null)
  const summaryCardRef = useRef<HTMLDivElement | null>(null)
  const receiptCardRef = useRef<HTMLDivElement | null>(null)
  const [sharing, setSharing] = useState<'summary' | 'receipt' | null>(null)

  // Fetch an order and hydrate each item with its product (getDoc → getDocById).
  async function fetchEnrichedOrder(orderId: string) {
    const data = await getDocById('orders', orderId)
    if (!data) return null
    const itemsWithProduct = await Promise.all(
      (data.items || []).map(async (it: any) => {
        try {
          const p = await getDocById('products', it.productId)
          return { ...it, product: p || null }
        } catch (e) {
          return { ...it, product: null }
        }
      }),
    )
    return { ...data, items: itemsWithProduct }
  }

  useEffect(() => {
    const orderId = id
    if (!orderId) return
    async function load() {
      try {
        const [custArr, prodArr, catArr, allergyArr] = await Promise.all([
          listDocs('customers'),
          listDocs('products'),
          listDocs('customerCategories'),
          listDocs('customerAllergies'),
        ])
        setCustomers(custArr)
        setProducts(prodArr)
        setCategoryRows(catArr)
        setAllergyRows(allergyArr)
      } catch (e) {}

      const data = await fetchEnrichedOrder(orderId!)
      if (data) {
        try {
          if (data.customerId) {
            const c = await getDocById('customers', data.customerId)
            setCustomer(c || null)
          }
        } catch (e) {
          setCustomer(null)
        }
        setOrder(data)
        setDeliveredBy(data.deliveredBy || '')
        setEditCustomerId(data.customerId || '')
        setEditCustomerInstructions(data.customerInstructions || '')
        setEditItems(
          (data.items || []).map((it: any) => ({
            productId: it.productId,
            qtyPackages: Number(it.qtyPackages ?? it.qty ?? 0),
          })),
        )
      }
    }
    load()
  }, [id])

  const customerName = customer?.name || order?.customerId || ''
  const customerPhone = [customer?.telephone1, customer?.telephone2].filter(Boolean).join(' / ')
  const customerLocation = [customer?.deliveryAddress1, customer?.deliveryAddress2, customer?.city]
    .filter(Boolean)
    .join(', ')
  const categoryLabelMap = Object.fromEntries(categoryRows.map((r) => [String(r.code), String(r.label || r.code)]))
  const allergyLabelMap = Object.fromEntries(allergyRows.map((r) => [String(r.code), String(r.label || r.code)]))

  const addEditItem = () => setEditItems((prev) => [...prev, { productId: '', qtyPackages: 1 }])
  const updateEditItem = (index: number, patch: any) => {
    setEditItems((prev) => {
      const copy = [...prev]
      copy[index] = { ...copy[index], ...patch }
      return copy
    })
  }
  const removeEditItem = (index: number) => {
    setEditItems((prev) => prev.filter((_, i) => i !== index))
  }
  const isEditValid = () => {
    if (!editCustomerId) return false
    if (editItems.length === 0) return false
    for (const it of editItems) {
      if (!it.productId) return false
      if (!it.qtyPackages || Number(it.qtyPackages) <= 0) return false
    }
    return true
  }
  const computeEditSubtotal = () =>
    editItems.reduce((s: number, it: any) => {
      if (!it.productId) return s
      const p = products.find((pp: any) => pp.id === it.productId)
      const unit = p ? Number(p.price ?? p.unitCost ?? 0) : 0
      return s + unit * Number(it.qtyPackages || 0)
    }, 0)

  async function saveOrderEdits() {
    if (!order) return
    if (order.paid || Number(order.amountPaid || 0) > 0 || Number(order.deliveryFee || 0) > 0) {
      showError('Orders with payments cannot be edited.')
      return
    }
    if (!isEditValid()) {
      showError('Select a customer and at least one valid item.')
      return
    }
    setError('')
    setSavingEdit(true)
    try {
      const orderItems = editItems.map((it: any) => ({
        productId: it.productId,
        qtyPackages: Number(it.qtyPackages),
      }))
      // Worker updates the order (items + recomputed totals) atomically.
      await callApi(`/api/orders/${order.id}/edit`, { body: { items: orderItems } })
      const fresh = await fetchEnrichedOrder(order.id)
      if (fresh) setOrder(fresh)
      setEditing(false)
      showSuccess('Order updated successfully.')
    } catch (err: any) {
      setError(err?.message || String(err) || 'Update failed')
    } finally {
      setSavingEdit(false)
    }
  }

  async function markPaid() {
    if (!order) return
    setError('')
    setLoading(true)
    try {
      if (!valueDate) throw new Error('Date of payment is required')
      const amt = Number(amountPaid)
      const fee = Number(deliveryFee)
      if (!Number.isFinite(amt) || amt <= 0) throw new Error('Amount paid is required')
      if (!Number.isFinite(fee) || fee < 0) throw new Error('Delivery fee must be 0 or more')

      // Worker records the payment + revenue and recomputes balance/paid atomically.
      await callApi(`/api/orders/${order.id}/markPaid`, {
        body: { amountPaid: amt, deliveryFee: fee, valueDate },
      })

      // Reload the authoritative order state to reflect server-computed totals.
      const fresh = await fetchEnrichedOrder(order.id)
      const nowPaid = !!fresh?.paid
      if (fresh) setOrder(fresh)
      setAmountPaid(0)
      setDeliveryFee(0)
      setPayDrawerOpen(false)
      if (nowPaid) {
        showSuccess('Order marked as fully paid!')
        setTimeout(() => navigate('/orders', { replace: true }), 800)
      } else {
        showSuccess('Payment recorded.')
      }
    } catch (err: any) {
      setError(err.message || 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  async function markDelivered() {
    if (!order) return
    if (!order.paid) {
      showError('Only paid orders can be marked as delivered.')
      return
    }
    if (order.delivered) {
      showError('This order is already delivered.')
      return
    }
    const rider = String(deliveredBy || '').trim()
    if (!rider) {
      showError('Please enter the rider name(s).')
      return
    }
    setError('')
    setDelivering(true)
    try {
      await updateDocById('orders', order.id, {
        status: 'delivered',
        delivered: true,
        deliveredBy: rider,
        deliveredAt: new Date().toISOString(),
      })
      setDeliverDrawerOpen(false)
      showSuccess('Order marked as delivered!')
      setTimeout(() => navigate('/orders', { replace: true }), 800)
    } catch (err: any) {
      setError(err?.message || 'Mark delivered failed')
    } finally {
      setDelivering(false)
    }
  }

  async function downloadPdf() {
    if (!invoiceRef.current) return
    await downloadInvoicePdf(invoiceRef.current, `invoice-${id}.pdf`)
  }

  async function shareSummaryImage(type: 'summary' | 'receipt') {
    const ref = type === 'receipt' ? receiptCardRef.current : summaryCardRef.current
    if (!ref) return
    setSharing(type)
    try {
      await shareOrderSummaryImage(ref, `order-${type}-${id?.slice(0, 8)}.png`)
    } catch {
      showError('Could not generate image. Try again.')
    } finally {
      setSharing(null)
    }
  }

  async function deleteUnpaidOrder() {
    if (!order) return
    if (order.paid) {
      showError('Paid orders cannot be deleted from this screen.')
      return
    }
    const code = await confirm('Enter authorization passcode to delete this transaction:', 'Delete Order', 'Passcode')
    if (!code) return
    if (String(code) !== DELETE_PASSCODE) {
      showError('Incorrect pin. Transaction was not deleted.')
      return
    }
    const confirmed = await confirm('Delete this unpaid order? This cannot be undone.', 'Confirm Delete')
    if (!confirmed) return

    setError('')
    setDeleting(true)
    try {
      // Worker deletes the order atomically (payments + revenue + audit + cascade).
      await callApi(`/api/orders/${order.id}/delete`, { body: { passcode: code } })
      navigate('/orders', { replace: true })
    } catch (err: any) {
      if (err instanceof ApiError && err.body?.error === 'invalid_passcode') {
        setError('Incorrect pin. Transaction was not deleted.')
        return
      }
      setError(err?.message || 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  if (!order) return <Box sx={{ p: 3 }}><CircularProgress /></Box>

  const computedOrderTotal = (order.items || []).reduce((sum: number, it: any) => sum + lineTotal(it), 0)
  const alreadyAmountPaid = Number(order.amountPaid || 0)
  const alreadyDeliveryFee = Number(order.deliveryFee || 0)
  const alreadyNetPaid = alreadyAmountPaid - alreadyDeliveryFee
  const alreadyBalance = computedOrderTotal - alreadyNetPaid

  const computedAmountPaid = Number(amountPaid || 0)
  const computedDeliveryFee = Number(deliveryFee || 0)
  const computedNetPaid = computedAmountPaid - computedDeliveryFee
  const nextAmountPaid = alreadyAmountPaid + computedAmountPaid
  const nextDeliveryFee = alreadyDeliveryFee + computedDeliveryFee
  const nextNetPaid = nextAmountPaid - nextDeliveryFee
  const nextBalance = computedOrderTotal - nextNetPaid

  const paymentReady =
    !order.paid &&
    !!valueDate &&
    Number.isFinite(computedAmountPaid) &&
    computedAmountPaid > 0 &&
    Number.isFinite(computedDeliveryFee) &&
    computedDeliveryFee >= 0 &&
    nextBalance >= -0.01

  const statusColor = order.delivered ? '#16a34a' : order.paid ? '#2563eb' : '#f59e0b'
  const statusLabel = order.delivered ? 'Delivered' : order.paid ? 'Paid' : 'Booked'

  // ── Payment form content (shared between drawer and inline) ────
  const PaymentForm = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {error && (
        <Box sx={{ p: 1.5, background: '#fee2e2', borderRadius: 1, color: '#991b1b', fontSize: 14 }}>{error}</Box>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' }, gap: 2 }}>
        <TextField
          label="Amount Paid"
          type="number"
          inputProps={{ min: 0, step: 0.01 }}
          value={amountPaid || ''}
          onChange={(e) => setAmountPaid(Number(e.target.value) || 0)}
          fullWidth
          size="small"
        />
        <TextField
          label="Delivery Fee"
          type="number"
          inputProps={{ min: 0, step: 0.01 }}
          value={deliveryFee || ''}
          onChange={(e) => setDeliveryFee(Number(e.target.value) || 0)}
          fullWidth
          size="small"
        />
        <TextField
          label="Payment Date"
          type="date"
          value={valueDate}
          onChange={(e) => setValueDate(e.target.value)}
          fullWidth
          size="small"
          InputLabelProps={{ shrink: true }}
        />
      </Box>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        {[
          ['Order Total', computedOrderTotal.toFixed(2)],
          ['Already Paid (net)', alreadyNetPaid.toFixed(2)],
          ['Current Balance', alreadyBalance.toFixed(2)],
          ['This Payment (net)', computedNetPaid.toFixed(2)],
        ].map(([label, val]) => (
          <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
            <Typography variant="body2" color="text.secondary">{label}</Typography>
            <Typography variant="body2" fontWeight={600}>{val}</Typography>
          </Box>
        ))}
        <Divider sx={{ my: 1 }} />
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography fontWeight={700}>Balance After</Typography>
          <Typography fontWeight={700} color={Math.abs(nextBalance) <= 0.01 ? 'success.main' : 'error.main'}>
            {nextBalance.toFixed(2)}
          </Typography>
        </Box>
      </Paper>
      <Button
        variant="contained"
        color="success"
        size="large"
        fullWidth
        disabled={loading || !paymentReady}
        onClick={markPaid}
        startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <PaymentIcon />}
      >
        {loading ? 'Processing...' : Math.abs(nextBalance) <= 0.01 ? 'Mark as Paid' : 'Record Payment'}
      </Button>
    </Box>
  )

  // ── Delivery form content ──────────────────────────────────────
  const DeliveryForm = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {error && (
        <Box sx={{ p: 1.5, background: '#fee2e2', borderRadius: 1, color: '#991b1b', fontSize: 14 }}>{error}</Box>
      )}
      <TextField
        label="Rider Name(s)"
        value={deliveredBy}
        onChange={(e) => setDeliveredBy(e.target.value)}
        fullWidth
        placeholder="Enter rider name(s)"
        autoFocus
      />
      <Button
        variant="contained"
        size="large"
        fullWidth
        disabled={delivering || !deliveredBy.trim()}
        onClick={markDelivered}
        startIcon={delivering ? <CircularProgress size={18} color="inherit" /> : <LocalShippingIcon />}
      >
        {delivering ? 'Saving...' : 'Confirm Delivery'}
      </Button>
    </Box>
  )

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: { xs: 1.5, md: 2.5 }, pb: isMobile ? 12 : 3 }}>
      {SnackbarElement}
      {ConfirmElement}

      {/* Header */}
      <Paper sx={{ p: { xs: 1.5, md: 2.5 }, mb: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <IconButton size="small" onClick={() => navigate('/orders')}><ArrowBackIcon /></IconButton>
              <Typography variant="h6" fontWeight={700}>Order #{id?.slice(0, 10)}…</Typography>
            </Box>
            <Chip label={statusLabel} size="small" sx={{ background: statusColor, color: '#fff', fontWeight: 600 }} />
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" startIcon={<AddCircleIcon />} onClick={() => navigate('/orders/new')} variant="outlined">
              {!isMobile && 'New Order'}
            </Button>
            <Button size="small" startIcon={<PictureAsPdfIcon />} onClick={downloadPdf} variant="outlined">
              {!isMobile && 'PDF'}
            </Button>
            <Button
              size="small"
              startIcon={sharing === 'summary' ? <CircularProgress size={14} color="inherit" /> : <IosShareIcon />}
              onClick={() => shareSummaryImage('summary')}
              variant="outlined"
              disabled={sharing !== null}
            >
              {!isMobile && 'Summary'}
            </Button>
            {order.paid && (
              <Button
                size="small"
                startIcon={sharing === 'receipt' ? <CircularProgress size={14} color="inherit" /> : <IosShareIcon />}
                onClick={() => shareSummaryImage('receipt')}
                variant="outlined"
                color="success"
                disabled={sharing !== null}
              >
                {!isMobile && 'Receipt'}
              </Button>
            )}
            {!order.paid && (
              <>
                <Button
                  size="small"
                  startIcon={<EditIcon />}
                  onClick={() => setEditing((v) => !v)}
                  variant="outlined"
                  disabled={deleting || loading || savingEdit}
                >
                  {editing ? 'Cancel' : !isMobile ? 'Edit' : ''}
                </Button>
                <Button
                  size="small"
                  startIcon={<DeleteIcon />}
                  color="error"
                  variant="outlined"
                  onClick={deleteUnpaidOrder}
                  disabled={deleting || loading}
                >
                  {deleting ? '...' : !isMobile ? 'Delete' : ''}
                </Button>
              </>
            )}
          </Box>
        </Box>
      </Paper>

      {/* Edit Mode */}
      {editing && !order.paid && (
        <Paper sx={{ p: 2.5, mb: 2, border: '2px solid #f59e0b', background: '#fef3c7' }}>
          <Typography variant="h6" color="warning.dark" gutterBottom>Edit Order</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography variant="body2" fontWeight={500} gutterBottom>Customer</Typography>
              <select className="select" value={editCustomerId} onChange={(e) => setEditCustomerId(e.target.value)} style={{ maxWidth: 400, width: '100%' }}>
                <option value="">--select--</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Box>
            <Box>
              <Typography variant="body2" fontWeight={500} gutterBottom>Order Items</Typography>
              {editItems.map((it, i) => (
                <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '1fr 100px auto', gap: 1.5, mb: 1.5, alignItems: 'flex-end' }}>
                  <Box>
                    <select className="select" value={it.productId} onChange={(e) => updateEditItem(i, { productId: e.target.value })} style={{ width: '100%' }}>
                      <option value="">-- select product --</option>
                      {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.type ? ` (${p.type})` : ''}</option>)}
                    </select>
                  </Box>
                  <TextField
                    size="small"
                    label="Qty"
                    type="number"
                    value={it.qtyPackages}
                    onChange={(e) => updateEditItem(i, { qtyPackages: Number(e.target.value) || 1 })}
                    inputProps={{ min: 1 }}
                  />
                  <IconButton color="error" onClick={() => removeEditItem(i)} size="small"><DeleteIcon /></IconButton>
                </Box>
              ))}
              <Button size="small" variant="outlined" onClick={addEditItem}>+ Add Item</Button>
            </Box>
            <TextField
              label="Customer Instructions"
              multiline
              rows={2}
              fullWidth
              value={editCustomerInstructions}
              onChange={(e) => setEditCustomerInstructions(e.target.value)}
            />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pt: 1, borderTop: '1px solid #f59e0b' }}>
              <Typography fontWeight={700}>Subtotal: {computeEditSubtotal().toFixed(2)}</Typography>
              <Button variant="contained" disabled={!isEditValid() || savingEdit} onClick={saveOrderEdits}>
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </Button>
            </Box>
            {error && <Box sx={{ p: 1.5, background: '#fee2e2', borderRadius: 1, color: '#991b1b' }}>{error}</Box>}
          </Box>
        </Paper>
      )}

      {/* Info cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 2, mb: 2 }}>
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>Customer Information</Typography>
          {[
            ['Name', customerName],
            ['Phone', customerPhone || '-'],
            ['Location', customerLocation || '-'],
            ['Categories', toLabelsText(customer?.categoryCodes, categoryLabelMap)],
            ['Allergies', toLabelsText(customer?.allergyCodes, allergyLabelMap)],
            ['Order Date', toJsDate(order.createdAt)?.toLocaleDateString() || '-'],
          ].map(([label, value]) => (
            <Box key={label} sx={{ mb: 1 }}>
              <Typography variant="caption" color="text.secondary">{label}</Typography>
              <Typography variant="body2" fontWeight={500}>{value}</Typography>
            </Box>
          ))}
        </Paper>

        <Paper sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>Payment Summary</Typography>
          {[
            ['Subtotal', computedOrderTotal.toFixed(2)],
            ['Amount Paid', alreadyAmountPaid.toFixed(2)],
            ['Delivery Fee', alreadyDeliveryFee.toFixed(2)],
          ].map(([label, val]) => (
            <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">{label}</Typography>
              <Typography variant="body2" fontWeight={600}>{val}</Typography>
            </Box>
          ))}
          <Divider sx={{ my: 1 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
            <Typography fontWeight={600}>Balance</Typography>
            <Typography fontWeight={700} fontSize={18} color={Math.abs(alreadyBalance) <= 0.01 ? 'success.main' : 'error.main'}>
              {alreadyBalance.toFixed(2)}
            </Typography>
          </Box>
          <Box sx={{
            p: 1.5, borderRadius: 1, textAlign: 'center', fontWeight: 600,
            background: order.paid ? '#d1fae5' : '#fee2e2',
            color: order.paid ? '#065f46' : '#991b1b',
          }}>
            {order.paid ? 'Fully Paid' : Number(order.amountPaid || 0) > 0 ? 'Partially Paid' : 'Unpaid'}
          </Box>
        </Paper>
      </Box>

      {/* Order Items */}
      <Paper sx={{ p: 2.5, mb: 2 }} ref={invoiceRef}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>Order Items</Typography>
        <Box sx={{ overflowX: 'auto' }}>
          <table className="table" style={{ minWidth: 400, width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 12px', background: '#f8fafc', fontSize: 12, color: '#64748b' }}>Product</th>
                <th style={{ textAlign: 'center', padding: '8px 12px', background: '#f8fafc', fontSize: 12, color: '#64748b' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', background: '#f8fafc', fontSize: 12, color: '#64748b' }}>Unit</th>
                <th style={{ textAlign: 'right', padding: '8px 12px', background: '#f8fafc', fontSize: 12, color: '#64748b' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {order.items?.map((it: any, idx: number) => {
                const unitCost = Number(it?.product?.price ?? it?.product?.unitCost ?? 0)
                const qty = Number(it.qtyPackages ?? it.qty ?? 0)
                const lineTotal = unitCost * qty
                return (
                  <tr key={idx}>
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>{it.product ? it.product.name : it.productId}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>{qty}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{unitCost.toFixed(2)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{lineTotal.toFixed(2)}</td>
                  </tr>
                )
              })}
              <tr style={{ borderTop: '2px solid #e5e7eb' }}>
                <td colSpan={3} style={{ textAlign: 'right', fontWeight: 600, padding: '10px 12px' }}>Subtotal</td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 16, padding: '10px 12px' }}>{computedOrderTotal.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </Box>
      </Paper>

      {/* Desktop: inline payment/delivery sections */}
      {!isMobile && (
        <>
          {order.paid && !order.delivered && (
            <Paper sx={{ p: 2.5, mb: 2, border: '2px solid #2563eb', background: '#dbeafe' }}>
              <Typography variant="h6" color="primary" gutterBottom>Mark as Delivered</Typography>
              {DeliveryForm}
            </Paper>
          )}
          {!order.paid && (
            <Paper sx={{ p: 2.5, border: '2px solid #10b981', background: '#d1fae5' }}>
              <Typography variant="h6" sx={{ color: '#065f46' }} gutterBottom>Record Payment</Typography>
              {PaymentForm}
            </Paper>
          )}
        </>
      )}

      {/* Mobile: context-aware FAB */}
      {isMobile && !order.delivered && (
        <Fab
          variant="extended"
          color={order.paid ? 'primary' : 'success'}
          sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1200 }}
          onClick={() => order.paid ? setDeliverDrawerOpen(true) : setPayDrawerOpen(true)}
        >
          {order.paid ? (
            <><LocalShippingIcon sx={{ mr: 1 }} />Mark Delivered</>
          ) : (
            <><PaymentIcon sx={{ mr: 1 }} />Record Payment</>
          )}
        </Fab>
      )}

      {/* Mobile: Pay Drawer */}
      <Drawer
        anchor="bottom"
        open={payDrawerOpen}
        onClose={() => setPayDrawerOpen(false)}
        sx={{ '& .MuiDrawer-paper': { borderTopLeftRadius: 16, borderTopRightRadius: 16 } }}
      >
        <Box sx={{ p: 2.5, maxHeight: '90vh', overflowY: 'auto' }}>
          <Box sx={{ width: 40, height: 4, bgcolor: 'grey.300', mx: 'auto', mt: 0, mb: 2, borderRadius: 2 }} />
          <Typography variant="h6" fontWeight={700} gutterBottom>Record Payment</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Order balance: <strong>{alreadyBalance.toFixed(2)}</strong>
          </Typography>
          {PaymentForm}
        </Box>
      </Drawer>

      {/* Mobile: Deliver Drawer */}
      <Drawer
        anchor="bottom"
        open={deliverDrawerOpen}
        onClose={() => setDeliverDrawerOpen(false)}
        sx={{ '& .MuiDrawer-paper': { borderTopLeftRadius: 16, borderTopRightRadius: 16 } }}
      >
        <Box sx={{ p: 2.5, pb: 4 }}>
          <Box sx={{ width: 40, height: 4, bgcolor: 'grey.300', mx: 'auto', mt: 0, mb: 2, borderRadius: 2 }} />
          <Typography variant="h6" fontWeight={700} gutterBottom>Confirm Delivery</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Customer: <strong>{customerName}</strong>
          </Typography>
          {DeliveryForm}
        </Box>
      </Drawer>

      {/* Off-screen cards for image generation */}
      <Box sx={{ position: 'absolute', left: -9999, top: 0, pointerEvents: 'none' }}>
        {/* Confirmation / Summary card */}
        <Box ref={summaryCardRef}>
          <OrderSummaryCard
            type="confirmation"
            customerName={customerName}
            customerPhone={customerPhone}
            orderDate={toJsDate(order.createdAt)?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) || ''}
            items={order.items || []}
            orderTotal={computedOrderTotal}
            deliveryFee={alreadyDeliveryFee}
            amountPaid={alreadyAmountPaid}
            balance={alreadyBalance}
            paid={order.paid}
          />
        </Box>
        {/* Receipt card (paid only) */}
        {order.paid && (
          <Box ref={receiptCardRef}>
            <OrderSummaryCard
              type="receipt"
              customerName={customerName}
              customerPhone={customerPhone}
              orderDate={(toJsDate(order.paidAt) || toJsDate(order.createdAt))?.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) || ''}
              items={order.items || []}
              orderTotal={computedOrderTotal}
              deliveryFee={alreadyDeliveryFee}
              amountPaid={alreadyAmountPaid}
              balance={0}
              paid={true}
            />
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ── Off-screen WhatsApp summary card ─────────────────────────────────────────
interface OrderSummaryCardProps {
  type: 'confirmation' | 'receipt'
  customerName: string
  customerPhone: string
  orderDate: string
  items: any[]
  orderTotal: number
  deliveryFee: number
  amountPaid: number
  balance: number
  paid: boolean
}

function OrderSummaryCard({ type, customerName, customerPhone, orderDate, items, orderTotal, deliveryFee, amountPaid, balance, paid }: OrderSummaryCardProps) {
  const subtotal = items.reduce((s: number, it: any) => s + lineTotal(it), 0)
  const grandTotal = subtotal + deliveryFee

  const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #e5e7eb', fontSize: 14 }
  const cellR: React.CSSProperties = { ...cell, textAlign: 'right' }

  return (
    <div style={{ width: 400, backgroundColor: '#ffffff', fontFamily: 'Arial, sans-serif', padding: 0 }}>
      {/* Header */}
      <div style={{ background: type === 'receipt' ? '#065f46' : '#1e3a5f', color: '#fff', padding: '18px 20px 14px' }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 1 }}>EH COST CENTER</div>
        <div style={{ fontSize: 13, marginTop: 4, opacity: 0.85 }}>
          {type === 'receipt' ? 'PAYMENT RECEIPT' : 'ORDER CONFIRMATION'}
        </div>
      </div>

      {/* Customer info */}
      <div style={{ padding: '14px 20px', borderBottom: '2px solid #e5e7eb', background: '#f8fafc' }}>
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Customer</span>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{customerName}</div>
        </div>
        {customerPhone && (
          <div style={{ fontSize: 13, color: '#475569' }}>Tel: {customerPhone}</div>
        )}
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Date: {orderDate}</div>
      </div>

      {/* Items table */}
      <div style={{ padding: '0 0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={{ ...cell, fontWeight: 600, fontSize: 11, color: '#64748b', textAlign: 'left', textTransform: 'uppercase' }}>Item</th>
              <th style={{ ...cellR, fontWeight: 600, fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>Qty</th>
              <th style={{ ...cellR, fontWeight: 600, fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>Unit</th>
              <th style={{ ...cellR, fontWeight: 600, fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it: any, i: number) => {
              const unit = Number(it?.product?.price ?? it?.product?.unitCost ?? 0)
              const qty = Number(it?.qtyPackages ?? it?.qty ?? 0)
              const name = it?.product?.name || it?.productId || ''
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={{ ...cell, fontWeight: 500 }}>{name}</td>
                  <td style={cellR}>{qty}</td>
                  <td style={cellR}>GH₵ {unit.toFixed(2)}</td>
                  <td style={{ ...cellR, fontWeight: 600 }}>GH₵ {(unit * qty).toFixed(2)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div style={{ padding: '12px 20px', borderTop: '2px solid #e5e7eb' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 14 }}>
          <span style={{ color: '#64748b' }}>Subtotal</span>
          <span style={{ fontWeight: 600 }}>GH₵ {subtotal.toFixed(2)}</span>
        </div>
        {deliveryFee > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 14 }}>
            <span style={{ color: '#64748b' }}>Delivery Fee</span>
            <span style={{ fontWeight: 600 }}>GH₵ {deliveryFee.toFixed(2)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 14, borderTop: '1px solid #e5e7eb', paddingTop: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>TOTAL</span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>GH₵ {grandTotal.toFixed(2)}</span>
        </div>
        {type === 'receipt' && amountPaid > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 4 }}>
            <span style={{ color: '#64748b' }}>Amount Paid</span>
            <span style={{ fontWeight: 600 }}>GH₵ {amountPaid.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Status banner */}
      <div style={{
        margin: '0 20px 20px',
        padding: '14px 20px',
        borderRadius: 8,
        textAlign: 'center',
        background: paid ? '#d1fae5' : '#fee2e2',
        color: paid ? '#065f46' : '#991b1b',
        fontWeight: 700,
        fontSize: 15,
      }}>
        {paid ? (
          <>✓ PAID — Balance: GH₵ 0.00</>
        ) : (
          <>⏳ OUTSTANDING — GH₵ {balance.toFixed(2)}</>
        )}
      </div>
    </div>
  )
}
