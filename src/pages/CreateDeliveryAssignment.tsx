import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { callApi, listDocs } from '../utils/dataClient'
import { useLiveCollection } from '../hooks/useLiveCollection'
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Fab,
  CircularProgress,
  Checkbox,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Chip,
  Divider,
  IconButton,
  Snackbar,
  Alert,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import LocalShippingIcon from '@mui/icons-material/LocalShipping'
import CheckIcon from '@mui/icons-material/Check'
import { useSnackbar } from '../hooks/useSnackbar'

export default function CreateDeliveryAssignment() {
  const navigate = useNavigate()
  const { showSuccess, showError, SnackbarElement } = useSnackbar()

  const [orders, setOrders] = useState<any[]>([])
  const [loadingOrders, setLoadingOrders] = useState(true)
  const [assignedOrders, setAssignedOrders] = useState<Map<string, string>>(new Map()) // orderId → companyName
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deliveryCompanyName, setDeliveryCompanyName] = useState('')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<{ shortCode: string; assignmentId: string } | null>(null)
  const [copySnack, setCopySnack] = useState(false)

  // Paid-but-not-delivered orders (live). Composite where paid==true && delivered==false.
  const { docs: rawOrders, loading: ordersLoading } = useLiveCollection('orders', {
    where: [
      { field: 'paid', op: '==', value: true },
      { field: 'delivered', op: '==', value: false },
    ],
  })
  // Single customers fetch → map (avoids one request per order during enrichment).
  const { docs: customerDocs } = useLiveCollection('customers')
  const customersById = React.useMemo(() => {
    const m: Record<string, any> = {}
    customerDocs.forEach((d) => (m[d.id] = d))
    return m
  }, [customerDocs])

  // Load active assignments once to know which orders are already assigned
  useEffect(() => {
    listDocs('delivery_assignments', {
      where: [{ field: 'status', op: 'in', value: ['pending', 'in_progress', 'all_reported'] }],
    })
      .then((rows) => {
        const map = new Map<string, string>()
        rows.forEach((a: any) => {
          ;(a.orderIds || []).forEach((oid: string) => map.set(oid, a.deliveryCompanyName || 'another assignment'))
        })
        setAssignedOrders(map)
      })
      .catch(() => {})
  }, [])

  // Enrich orders with customer contact details from the in-memory customers map.
  useEffect(() => {
    const enriched = rawOrders.map((o: any) => {
      let customerName = o.customerId || ''
      let customerPhone = ''
      let deliveryAddress = ''
      const cd = customersById[o.customerId]
      if (cd) {
        customerName = cd.name || customerName
        customerPhone = [cd.telephone1, cd.telephone2].filter(Boolean).join(' / ')
        deliveryAddress = [cd.deliveryAddress1, cd.city].filter(Boolean).join(', ')
      }
      return { ...o, customerName, customerPhone, deliveryAddress }
    })
    setOrders(enriched)
    if (!ordersLoading) setLoadingOrders(false)
  }, [rawOrders, ordersLoading, customersById])

  const filtered = orders.filter((o) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      String(o.customerName || '').toLowerCase().includes(q) ||
      String(o.customerPhone || '').toLowerCase().includes(q) ||
      String(o.deliveryAddress || '').toLowerCase().includes(q)
    )
  })

  function toggleSelect(id: string) {
    if (assignedOrders.has(id)) return // already assigned elsewhere
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectableFiltered = filtered.filter((o) => !assignedOrders.has(o.id))

  function toggleAll() {
    if (selectedIds.size === selectableFiltered.length && selectableFiltered.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(selectableFiltered.map((o) => o.id)))
    }
  }

  async function handleCreate() {
    if (selectedIds.size === 0) { showError('Select at least one order'); return }
    if (!deliveryCompanyName.trim()) { showError('Enter delivery company name'); return }
    setSubmitting(true)
    try {
      const data = await callApi('/api/delivery-assignments', {
        body: {
          orderIds: Array.from(selectedIds),
          deliveryCompanyName: deliveryCompanyName.trim(),
          notes: notes.trim() || undefined,
        },
      })
      setCreated({ shortCode: data.shortCode, assignmentId: data.assignmentId })
    } catch (err: any) {
      showError(err?.message || 'Create failed')
    } finally {
      setSubmitting(false)
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => setCopySnack(true))
  }

  const publicUrl = created ? `${window.location.origin}/d/${created.shortCode}` : ''

  // ── Success screen ───────────────────────────────────────────────
  if (created) {
    return (
      <Box sx={{ maxWidth: 500, mx: 'auto', p: { xs: 2, sm: 4 }, textAlign: 'center' }}>
        <CheckIcon sx={{ fontSize: 64, color: '#10b981', mb: 2 }} />
        <Typography variant="h5" fontWeight={700} gutterBottom>Assignment Created!</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Share this code or URL with the delivery company:
        </Typography>

        <Paper sx={{ p: 3, mb: 2, background: '#1e293b', borderRadius: 3 }}>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', letterSpacing: 2 }}>SHORT CODE</Typography>
          <Typography
            sx={{
              fontSize: 52,
              fontWeight: 900,
              letterSpacing: 12,
              color: '#fff',
              fontFamily: 'monospace',
              my: 1,
            }}
          >
            {created.shortCode}
          </Typography>
          <Button
            variant="outlined"
            startIcon={<ContentCopyIcon />}
            onClick={() => copyToClipboard(created.shortCode)}
            sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)', mt: 1 }}
          >
            Copy Code
          </Button>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>Delivery URL</Typography>
          <Typography
            variant="body2"
            sx={{ fontFamily: 'monospace', wordBreak: 'break-all', fontWeight: 600 }}
          >
            {publicUrl}
          </Typography>
          <Button
            startIcon={<ContentCopyIcon />}
            size="small"
            sx={{ mt: 1 }}
            onClick={() => copyToClipboard(publicUrl)}
          >
            Copy URL
          </Button>
        </Paper>

        <Box sx={{ display: 'flex', gap: 1.5, flexDirection: 'column' }}>
          <Button variant="contained" fullWidth onClick={() => navigate('/delivery-assignments')}>
            View All Assignments
          </Button>
          <Button variant="outlined" fullWidth onClick={() => navigate('/orders')}>
            Back to Orders
          </Button>
        </Box>

        <Snackbar open={copySnack} autoHideDuration={2000} onClose={() => setCopySnack(false)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert severity="success" variant="filled">Copied to clipboard!</Alert>
        </Snackbar>
      </Box>
    )
  }

  // ── Create form ──────────────────────────────────────────────────
  return (
    <Box sx={{ maxWidth: 700, mx: 'auto', p: { xs: 1.5, sm: 3 }, pb: 12 }}>
      {SnackbarElement}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <IconButton onClick={() => navigate('/delivery-assignments')}><ArrowBackIcon /></IconButton>
        <Typography variant="h5" fontWeight={700}>New Delivery Assignment</Typography>
      </Box>

      {/* Company details */}
      <Paper sx={{ p: 2.5, mb: 2 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>Delivery Details</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            label="Delivery Company Name *"
            value={deliveryCompanyName}
            onChange={(e) => setDeliveryCompanyName(e.target.value)}
            fullWidth
            size="small"
            placeholder="e.g. FastDelivery GH"
          />
          <TextField
            label="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={2}
            placeholder="Any instructions for the delivery company..."
          />
        </Box>
      </Paper>

      {/* Order selection */}
      <Paper sx={{ mb: 2 }}>
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e5e7eb' }}>
          <Box>
            <Typography variant="subtitle2" fontWeight={600}>Select Orders</Typography>
            <Typography variant="caption" color="text.secondary">
              Paid, not yet delivered — {selectedIds.size} selected
            </Typography>
          </Box>
          <Button size="small" onClick={toggleAll}>
            {selectedIds.size === filtered.length && filtered.length > 0 ? 'Deselect All' : 'Select All'}
          </Button>
        </Box>

        <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Search by name, phone, or address"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </Box>

        {loadingOrders ? (
          <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress /></Box>
        ) : filtered.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center', color: '#94a3b8' }}>
            <Typography>No paid orders awaiting delivery.</Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {filtered.map((order, i) => {
              const alreadyAssignedTo = assignedOrders.get(order.id)
              const isDisabled = !!alreadyAssignedTo
              return (
                <React.Fragment key={order.id}>
                  {i > 0 && <Divider />}
                  <ListItem disablePadding>
                    <ListItemButton
                      onClick={() => toggleSelect(order.id)}
                      disabled={isDisabled}
                      sx={{ py: 1.5, opacity: isDisabled ? 0.55 : 1 }}
                    >
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        <Checkbox
                          edge="start"
                          checked={selectedIds.has(order.id)}
                          tabIndex={-1}
                          disableRipple
                          disabled={isDisabled}
                        />
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                            <Typography fontWeight={600}>{order.customerName}</Typography>
                            <Chip label="Paid" color="primary" size="small" />
                            {isDisabled && (
                              <Chip
                                label={`Assigned: ${alreadyAssignedTo}`}
                                color="warning"
                                size="small"
                                variant="outlined"
                              />
                            )}
                          </Box>
                        }
                        secondary={
                          <Box component="span">
                            <Typography variant="caption" display="block">{order.customerPhone}</Typography>
                            {order.deliveryAddress && (
                              <Typography variant="caption" display="block" color="text.secondary">
                                📍 {order.deliveryAddress}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                </React.Fragment>
              )
            })}
          </List>
        )}
      </Paper>

      {/* Submit FAB */}
      <Fab
        variant="extended"
        color="primary"
        sx={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 1200,
          px: 3,
        }}
        disabled={selectedIds.size === 0 || !deliveryCompanyName.trim() || submitting}
        onClick={handleCreate}
      >
        {submitting ? (
          <CircularProgress size={20} color="inherit" sx={{ mr: 1 }} />
        ) : (
          <LocalShippingIcon sx={{ mr: 1 }} />
        )}
        {submitting ? 'Creating...' : `Assign ${selectedIds.size > 0 ? `(${selectedIds.size})` : ''}`}
      </Fab>
    </Box>
  )
}
