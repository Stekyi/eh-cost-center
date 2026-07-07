import React, { useEffect, useState } from 'react'
import { listDocs, createDoc } from '../utils/dataClient'
import { useNavigate } from 'react-router-dom'
import { toLabelsText } from '../utils/customerSegments'
import {
  useTheme,
  useMediaQuery,
  Box,
  Button,
  Fab,
  Stepper,
  Step,
  StepLabel,
  Autocomplete,
  TextField,
  Paper,
  Typography,
  Chip,
  IconButton,
  CircularProgress,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import CheckIcon from '@mui/icons-material/Check'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import { useSnackbar } from '../hooks/useSnackbar'

const STEPS = ['Customer', 'Items', 'Review & Submit']

export default function OrderBooking() {
  const [customerId, setCustomerId] = useState('')
  const [customers, setCustomers] = useState<any[]>([])
  const [items, setItems] = useState<any[]>([{ productId: '', qtyPackages: 1 }])
  const [customerInstructions, setCustomerInstructions] = useState('')
  const [products, setProducts] = useState<any[]>([])
  const [categoryRows, setCategoryRows] = useState<any[]>([])
  const [allergyRows, setAllergyRows] = useState<any[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [activeStep, setActiveStep] = useState(0)
  const [lastOrderId, setLastOrderId] = useState<string | null>(null)

  const navigate = useNavigate()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const { showSuccess, showError, SnackbarElement } = useSnackbar()

  // Track visible viewport height so nav buttons stay above the keyboard
  const [navBottom, setNavBottom] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const keyboardHeight = window.innerHeight - vv.height - vv.offsetTop
      setNavBottom(Math.max(0, keyboardHeight))
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  useEffect(() => {
    async function load() {
      const [custArr, pArr, catArr, algArr] = await Promise.all([
        listDocs('customers'),
        listDocs('products'),
        listDocs('customerCategories'),
        listDocs('customerAllergies'),
      ])
      setCustomers([...custArr].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))))
      setProducts([...pArr].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))))
      setCategoryRows(catArr)
      setAllergyRows(algArr)
    }
    load()
  }, [])

  const categoryLabelMap = Object.fromEntries(categoryRows.map((r) => [String(r.code), String(r.label || r.code)]))
  const allergyLabelMap = Object.fromEntries(allergyRows.map((r) => [String(r.code), String(r.label || r.code)]))

  const selectedCustomer = customers.find((c) => c.id === customerId) || null

  const addItem = () => setItems((prev) => [...prev, { productId: '', qtyPackages: 1 }])

  const updateItem = (index: number, patch: any) => {
    setItems((prev) => {
      const copy = [...prev]
      copy[index] = { ...copy[index], ...patch }
      return copy
    })
  }

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const computeSubtotal = () =>
    items.reduce((s, it) => {
      if (!it.productId) return s
      const p = products.find((p) => p.id === it.productId)
      const price = p ? Number(p.price || p.unitCost || 0) : 0
      return s + price * Number(it.qtyPackages || 0)
    }, 0)

  const isValid = () => {
    if (!customerId) return false
    if (items.length === 0) return false
    for (const it of items) {
      if (!it.productId) return false
      if (!it.qtyPackages || Number(it.qtyPackages) <= 0) return false
    }
    return true
  }

  const stepValid = (step: number) => {
    if (step === 0) return !!customerId
    if (step === 1) return items.length > 0 && items.every((it) => it.productId && Number(it.qtyPackages) > 0)
    return isValid()
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    if (!isValid()) {
      showError('Please select a customer and add at least one valid item.')
      return
    }
    setSubmitting(true)
    try {
      const orderItems = items.map((it) => ({ productId: it.productId, qtyPackages: Number(it.qtyPackages) }))
      const productIds = orderItems.map((it) => it.productId)
      const ref = await createDoc('orders', {
        customerId,
        items: orderItems,
        productIds,
        status: 'booked',
        paid: false,
        delivered: false,
        deliveredBy: '',
        amountPaid: 0,
        // Register the order cost at booking so it stays fixed even if product
        // prices change later (payment validates amountPaid − deliveryFee == total).
        total: computeSubtotal(),
        customerInstructions,
      })
      showSuccess('Order created successfully!')
      setLastOrderId(ref.id)
    } catch (err: any) {
      showError(err?.message || 'Failed to create order')
    } finally {
      setSubmitting(false)
    }
  }

  function resetForm() {
    setCustomerId('')
    setItems([{ productId: '', qtyPackages: 1 }])
    setCustomerInstructions('')
    setActiveStep(0)
    setLastOrderId(null)
  }

  // ── Customer Step ──────────────────────────────────────────────
  const CustomerStep = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Autocomplete
        options={customers}
        getOptionLabel={(c: any) => c.name || ''}
        value={selectedCustomer}
        onChange={(_e, val) => setCustomerId(val?.id || '')}
        componentsProps={isMobile ? { popper: { placement: 'top' } } : undefined}
        renderOption={(props, c: any) => (
          <li {...props} key={c.id}>
            <Box>
              <Typography fontWeight={600}>{c.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {[c.telephone1, c.telephone2].filter(Boolean).join(' / ') || 'No phone'} &bull;{' '}
                {[c.deliveryAddress1, c.city].filter(Boolean).join(', ') || 'No address'}
              </Typography>
            </Box>
          </li>
        )}
        renderInput={(params) => (
          <TextField {...params} label="Search customer by name, phone, or city" size="medium" fullWidth />
        )}
        filterOptions={(options, { inputValue }) => {
          if (!inputValue) return options
          const q = inputValue.toLowerCase()
          return options.filter(
            (c: any) =>
              String(c.name || '').toLowerCase().includes(q) ||
              String(c.telephone1 || '').toLowerCase().includes(q) ||
              String(c.telephone2 || '').toLowerCase().includes(q) ||
              String(c.city || '').toLowerCase().includes(q),
          )
        }}
      />
      {selectedCustomer && (
        <Paper
          variant="outlined"
          sx={{ p: 2, background: '#dbeafe', borderColor: '#3b82f6', borderRadius: 2 }}
        >
          <Typography fontWeight={700} color="primary" gutterBottom>
            Customer Selected
          </Typography>
          <Typography variant="body2"><strong>Phone:</strong> {[selectedCustomer.telephone1, selectedCustomer.telephone2].filter(Boolean).join(' / ') || 'None'}</Typography>
          <Typography variant="body2"><strong>Address:</strong> {[selectedCustomer.deliveryAddress1, selectedCustomer.city].filter(Boolean).join(', ') || 'None'}</Typography>
          {selectedCustomer.categoryCodes?.length > 0 && (
            <Typography variant="body2"><strong>Categories:</strong> {toLabelsText(selectedCustomer.categoryCodes, categoryLabelMap)}</Typography>
          )}
          {selectedCustomer.allergyCodes?.length > 0 && (
            <Typography variant="body2" color="error"><strong>Allergies:</strong> {toLabelsText(selectedCustomer.allergyCodes, allergyLabelMap)}</Typography>
          )}
        </Paper>
      )}
    </Box>
  )

  // ── Items Step ─────────────────────────────────────────────────
  const ItemsStep = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {items.map((it, i) => {
        const prod = products.find((p) => p.id === it.productId) || null
        const lineTotal = prod ? Number(prod.price || prod.unitCost || 0) * Number(it.qtyPackages || 0) : 0
        return (
          <Paper key={i} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Autocomplete
                  options={products}
                  getOptionLabel={(p: any) => p.name || ''}
                  value={prod}
                  onChange={(_e, val) => updateItem(i, { productId: val?.id || '' })}
                  componentsProps={isMobile ? { popper: { placement: 'top' } } : undefined}
                  renderInput={(params) => (
                    <TextField {...params} label="Product" size="small" fullWidth error={!it.productId} />
                  )}
                />
                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                  <TextField
                    label="Qty"
                    type="number"
                    size="small"
                    value={it.qtyPackages}
                    onChange={(e) => {
                      const num = Number(e.target.value)
                      updateItem(i, { qtyPackages: isNaN(num) ? it.qtyPackages : num })
                    }}
                    inputProps={{ min: 1 }}
                    error={Number(it.qtyPackages) <= 0}
                    sx={{ width: 80 }}
                  />
                  {prod && (
                    <Chip
                      label={`Total: ${lineTotal.toFixed(2)}`}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  )}
                </Box>
              </Box>
              <IconButton color="error" onClick={() => removeItem(i)} disabled={items.length <= 1} sx={{ mt: 0.5 }}>
                <DeleteIcon />
              </IconButton>
            </Box>
          </Paper>
        )
      })}
      <Button startIcon={<AddIcon />} onClick={addItem} variant="outlined" fullWidth>
        Add Item
      </Button>
      {items.length > 0 && (
        <Paper sx={{ p: 2, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 2 }}>
          <Typography fontWeight={700}>Subtotal: {computeSubtotal().toFixed(2)}</Typography>
        </Paper>
      )}
    </Box>
  )

  // ── Review Step ────────────────────────────────────────────────
  const ReviewStep = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {selectedCustomer && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
          <Typography fontWeight={600} gutterBottom>Customer</Typography>
          <Typography>{selectedCustomer.name}</Typography>
          <Typography variant="body2" color="text.secondary">{[selectedCustomer.telephone1, selectedCustomer.city].filter(Boolean).join(' · ')}</Typography>
        </Paper>
      )}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Typography fontWeight={600} gutterBottom>Items ({items.length})</Typography>
        {items.map((it, i) => {
          const prod = products.find((p) => p.id === it.productId)
          const lineTotal = prod ? Number(prod.price || prod.unitCost || 0) * Number(it.qtyPackages || 0) : 0
          return (
            <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
              <Typography variant="body2">{prod?.name || 'Unknown'} × {it.qtyPackages}</Typography>
              <Typography variant="body2" fontWeight={600}>{lineTotal.toFixed(2)}</Typography>
            </Box>
          )
        })}
        <Box sx={{ borderTop: '1px solid #e5e7eb', mt: 1, pt: 1, display: 'flex', justifyContent: 'space-between' }}>
          <Typography fontWeight={700}>Total</Typography>
          <Typography fontWeight={700}>{computeSubtotal().toFixed(2)}</Typography>
        </Box>
      </Paper>
      <TextField
        label="Customer Instructions (optional)"
        multiline
        rows={3}
        fullWidth
        value={customerInstructions}
        onChange={(e) => setCustomerInstructions(e.target.value)}
        placeholder="Special requests, dietary needs, delivery notes..."
      />
    </Box>
  )

  const stepContent = [CustomerStep, ItemsStep, ReviewStep]

  // ── Success screen (shared mobile + desktop) ───────────────────
  if (lastOrderId) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', p: { xs: 3, sm: 4 }, textAlign: 'center' }}>
        {SnackbarElement}
        <CheckIcon sx={{ fontSize: 72, color: '#10b981', mb: 2 }} />
        <Typography variant="h5" fontWeight={700} gutterBottom>Order Created!</Typography>
        <Typography color="text.secondary" sx={{ mb: 4 }}>
          The order has been booked successfully.
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Button variant="contained" size="large" fullWidth startIcon={<AddIcon />} onClick={resetForm}>
            Book Another Order
          </Button>
          <Button variant="outlined" size="large" fullWidth onClick={() => navigate(`/orders/${lastOrderId}`)}>
            View This Order
          </Button>
          <Button size="large" fullWidth onClick={() => navigate('/orders')}>
            Back to Orders List
          </Button>
        </Box>
      </Box>
    )
  }

  // ── Desktop layout ─────────────────────────────────────────────
  if (!isMobile) {
    return (
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '20px' }}>
        {SnackbarElement}
        <Paper sx={{ p: 3, mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Box>
              <Typography variant="h5" fontWeight={700}>Create New Order</Typography>
              <Typography variant="body2" color="text.secondary">Fill in the details below to book a new order</Typography>
            </Box>
            <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={() => navigate('/orders')}>Back to Orders</Button>
          </Box>
        </Paper>

        <form onSubmit={submit}>
          <Paper sx={{ p: 3, mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={600} color="text.secondary" gutterBottom>Customer</Typography>
            {CustomerStep}
          </Paper>
          <Paper sx={{ p: 3, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle1" fontWeight={600} color="text.secondary">Order Items</Typography>
              <Button startIcon={<AddIcon />} onClick={addItem} size="small">Add Item</Button>
            </Box>
            {items.map((it, i) => {
              const prod = products.find((p) => p.id === it.productId) || null
              const lineTotal = prod ? Number(prod.price || prod.unitCost || 0) * Number(it.qtyPackages || 0) : 0
              return (
                <Paper key={i} variant="outlined" sx={{ p: 2, mb: 1.5, borderRadius: 2 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px auto', gap: 1.5, alignItems: 'flex-end' }}>
                    <Autocomplete
                      options={products}
                      getOptionLabel={(p: any) => p.name || ''}
                      value={prod}
                      onChange={(_e, val) => updateItem(i, { productId: val?.id || '' })}
                      renderInput={(params) => <TextField {...params} label="Product" size="small" error={!it.productId} />}
                    />
                    <TextField
                      label="Qty"
                      type="number"
                      size="small"
                      value={it.qtyPackages}
                      onChange={(e) => updateItem(i, { qtyPackages: Number(e.target.value) || 1 })}
                      inputProps={{ min: 1 }}
                    />
                    <TextField label="Line Total" size="small" value={lineTotal.toFixed(2)} InputProps={{ readOnly: true }} />
                    <IconButton color="error" onClick={() => removeItem(i)} disabled={items.length <= 1}>
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                </Paper>
              )
            })}
          </Paper>
          <Paper sx={{ p: 3, mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={600} color="text.secondary" gutterBottom>Customer Instructions</Typography>
            <TextField
              multiline
              rows={3}
              fullWidth
              value={customerInstructions}
              onChange={(e) => setCustomerInstructions(e.target.value)}
              placeholder="Special requests, dietary needs, delivery notes..."
            />
          </Paper>
          <Paper sx={{ p: 3, position: 'sticky', bottom: 16 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
              <Box>
                <Typography variant="body2" color="text.secondary">Order Subtotal</Typography>
                <Typography variant="h4" fontWeight={700}>{computeSubtotal().toFixed(2)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button variant="outlined" onClick={() => navigate('/orders')}>Cancel</Button>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={!isValid() || submitting}
                  startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <CheckIcon />}
                  sx={{ px: 4 }}
                >
                  {submitting ? 'Creating...' : isValid() ? 'Create Order' : 'Incomplete'}
                </Button>
              </Box>
            </Box>
          </Paper>
        </form>
      </div>
    )
  }

  // ── Mobile wizard layout ───────────────────────────────────────
  return (
    <Box sx={{ pb: 10 }}>
      {SnackbarElement}
      {/* Header */}
      <Paper square sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1, mb: 0 }}>
        <IconButton size="small" onClick={() => navigate('/orders')}><ArrowBackIcon /></IconButton>
        <Typography variant="h6" fontWeight={700} sx={{ flex: 1 }}>New Order</Typography>
        {activeStep === 2 && (
          <Typography variant="body2" fontWeight={600} color="primary">{computeSubtotal().toFixed(2)}</Typography>
        )}
      </Paper>

      {/* Stepper */}
      <Box sx={{ px: 2, py: 1.5, background: '#f8fafc' }}>
        <Stepper activeStep={activeStep} alternativeLabel>
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      {/* Step content */}
      <Box sx={{ px: 2, pt: 2 }}>
        {stepContent[activeStep]}
      </Box>

      {/* Navigation buttons — navBottom pushes them above the keyboard */}
      <Paper
        elevation={3}
        sx={{
          position: 'fixed',
          bottom: navBottom,
          left: 0,
          right: 0,
          px: 2,
          py: 1.5,
          display: 'flex',
          gap: 1,
          zIndex: 1200,
          transition: 'bottom 0.1s ease',
        }}
      >
        {activeStep > 0 && (
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={() => setActiveStep((s) => s - 1)}
            sx={{ flex: 1 }}
          >
            Back
          </Button>
        )}
        {activeStep < STEPS.length - 1 ? (
          <Button
            variant="contained"
            endIcon={<ArrowForwardIcon />}
            onClick={() => setActiveStep((s) => s + 1)}
            disabled={!stepValid(activeStep)}
            sx={{ flex: 2 }}
          >
            Next
          </Button>
        ) : (
          <Fab
            variant="extended"
            color="primary"
            onClick={submit}
            disabled={!isValid() || submitting}
            sx={{ flex: 2, height: 48, borderRadius: 3 }}
          >
            {submitting ? <CircularProgress size={20} color="inherit" sx={{ mr: 1 }} /> : <CheckIcon sx={{ mr: 1 }} />}
            {submitting ? 'Creating...' : 'Create Order'}
          </Fab>
        )}
      </Paper>
    </Box>
  )
}
