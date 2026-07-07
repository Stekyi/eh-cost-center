import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { callApi, API_BASE } from '../utils/dataClient'
import { useLiveCollection } from '../hooks/useLiveCollection'
import { formatDate } from '../utils/dates'
import {
  Box,
  Paper,
  Typography,
  Button,
  Fab,
  Chip,
  Collapse,
  Divider,
  CircularProgress,
  Tabs,
  Tab,
  IconButton,
  Tooltip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import LocalShippingIcon from '@mui/icons-material/LocalShipping'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline'
import { useSnackbar } from '../hooks/useSnackbar'
import { useConfirmDialog } from '../hooks/useConfirmDialog'

// Status display config
const STATUS_COLORS: Record<string, any> = {
  pending: 'default',
  in_progress: 'warning',
  all_reported: 'info',
  completed: 'success',
}
const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  all_reported: 'All Reported',
  completed: 'Completed',
}

// Public API base for API docs shown to delivery companies
const CF_BASE = API_BASE

export default function DeliveryAssignments() {
  const navigate = useNavigate()
  const { showSuccess, showError, SnackbarElement } = useSnackbar()
  const { confirm, ConfirmElement } = useConfirmDialog()

  const { docs: assignments, loading, refresh } = useLiveCollection('delivery_assignments', {
    orderBy: { field: 'createdAt', dir: 'desc' },
  })
  const [tabValue, setTabValue] = useState(0) // 0=All, 1=Active, 2=All Reported, 3=Completed
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [reconciling, setReconciling] = useState<string | null>(null)

  // Auto-expand assignments with delivered items that aren't yet completed
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev)
      assignments.forEach((a) => {
        const hasDelivered = (a.items || []).some((it: any) => it.deliveryStatus === 'delivered')
        if (hasDelivered && a.status !== 'completed') next.add(a.id)
      })
      return next
    })
  }, [assignments])

  // Tab filters: All | Active (pending+in_progress) | All Reported | Completed
  const tabDefs = [
    { label: 'All', filter: (a: any) => true },
    { label: 'Active', filter: (a: any) => a.status === 'pending' || a.status === 'in_progress' },
    { label: 'All Reported', filter: (a: any) => a.status === 'all_reported' },
    { label: 'Completed', filter: (a: any) => a.status === 'completed' },
  ]
  const filtered = assignments.filter(tabDefs[tabValue].filter)

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function reconcile(assignment: any) {
    const deliveredItems = (assignment.items || []).filter((it: any) => it.deliveryStatus === 'delivered')
    if (deliveredItems.length === 0) {
      showError('No delivered items to confirm yet.')
      return
    }

    const confirmed = await confirm(
      `Confirm ${deliveredItems.length} order(s) as delivered by ${assignment.deliveryCompanyName}?\n\nThis will update the order list and cannot be undone.`,
      'Confirm Deliveries',
    )
    if (!confirmed) return

    setReconciling(assignment.id)
    try {
      const data = await callApi(`/api/delivery-assignments/${assignment.id}/reconcile`, {})
      showSuccess(`${data.reconciledCount} order(s) confirmed as delivered!`)
      refresh()
    } catch (err: any) {
      showError(err?.message || 'Confirm failed')
    } finally {
      setReconciling(null)
    }
  }

  async function removeItem(assignment: any, orderId: string, customerName: string) {
    const ok = await confirm(
      `Remove "${customerName}" from this assignment?\n\nThe order will become available to assign again.`,
      'Unassign Order',
    )
    if (!ok) return
    try {
      await callApi(`/api/delivery-assignments/${assignment.id}/items/${orderId}`, { method: 'DELETE' })
      showSuccess('Order unassigned successfully.')
      refresh()
    } catch (err: any) {
      showError(err?.message || 'Remove failed')
    }
  }

  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => showSuccess(`${label} copied!`))
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', pt: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  const activeCount = assignments.filter((a) => a.status === 'pending' || a.status === 'in_progress').length
  const reportedCount = assignments.filter((a) => a.status === 'all_reported').length

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', p: { xs: 1.5, sm: 3 }, pb: 10 }}>
      {SnackbarElement}
      {ConfirmElement}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Delivery Assignments</Typography>
          <Typography variant="body2" color="text.secondary">
            {assignments.length} total · {activeCount} active
            {reportedCount > 0 && ` · `}
            {reportedCount > 0 && <span style={{ color: '#0288d1', fontWeight: 600 }}>{reportedCount} awaiting confirmation</span>}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/delivery-assignments/new')}>
          New Assignment
        </Button>
      </Box>

      <Tabs
        value={tabValue}
        onChange={(_e, v) => setTabValue(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        {tabDefs.map((t, i) => {
          const count = assignments.filter(t.filter).length
          return <Tab key={i} label={`${t.label} (${count})`} />
        })}
      </Tabs>

      {filtered.length === 0 && (
        <Box sx={{ py: 8, textAlign: 'center', color: '#94a3b8' }}>
          <LocalShippingIcon sx={{ fontSize: 64, opacity: 0.3, mb: 2 }} />
          <Typography>No assignments in this category.</Typography>
          <Button sx={{ mt: 2 }} variant="outlined" onClick={() => navigate('/delivery-assignments/new')}>
            Create First Assignment
          </Button>
        </Box>
      )}

      {filtered.map((assignment) => {
        const items: any[] = assignment.items || []
        const deliveredCount = items.filter((it) => it.deliveryStatus === 'delivered').length
        const failedCount = items.filter((it) => it.deliveryStatus === 'failed').length
        const pendingCount = items.filter((it) => it.deliveryStatus === 'pending').length
        const isExpanded = expanded.has(assignment.id)
        const canConfirm = assignment.status !== 'completed' && deliveredCount > 0
        const isReconciling = reconciling === assignment.id
        const createdDate = formatDate(assignment.createdAt, '')

        const webUrl = `${window.location.origin}/d/${assignment.shortCode}`
        const apiBase = `${CF_BASE}/delivery/${assignment.shortCode}`

        return (
          <Paper key={assignment.id} sx={{ mb: 2, borderRadius: 2, overflow: 'hidden', border: assignment.status === 'all_reported' ? '2px solid #0288d1' : 'none' }}>
            {/* Card header */}
            <Box
              sx={{
                p: 2,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                cursor: 'pointer',
                '&:hover': { background: '#f8fafc' },
                background: assignment.status === 'all_reported' ? '#e1f5fe' : 'transparent',
              }}
              onClick={() => toggleExpand(assignment.id)}
            >
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
                  <Typography fontWeight={700} fontSize={16}>{assignment.deliveryCompanyName}</Typography>
                  <Chip
                    label={STATUS_LABELS[assignment.status] || assignment.status}
                    color={STATUS_COLORS[assignment.status] || 'default'}
                    size="small"
                  />
                  {assignment.status === 'all_reported' && (
                    <Chip label="Action Required" color="info" size="small" variant="outlined" />
                  )}
                </Box>

                {/* Progress chips */}
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
                  {deliveredCount > 0 && (
                    <Chip icon={<CheckCircleIcon />} label={`${deliveredCount} delivered`} color="success" size="small" />
                  )}
                  {failedCount > 0 && (
                    <Chip label={`${failedCount} failed`} color="error" size="small" />
                  )}
                  {pendingCount > 0 && (
                    <Chip label={`${pendingCount} pending`} size="small" />
                  )}
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">{createdDate}</Typography>
                  <Typography variant="caption" color="text.secondary">·</Typography>
                  <Typography
                    variant="caption"
                    sx={{ fontFamily: 'monospace', background: '#f1f5f9', px: 1, py: 0.25, borderRadius: 1, fontWeight: 700 }}
                  >
                    {assignment.shortCode}
                  </Typography>
                  <Tooltip title="Copy driver URL">
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); copyText(webUrl, 'Driver URL') }}>
                      <ContentCopyIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
              <IconButton size="small" sx={{ ml: 1 }}>
                {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            </Box>

            {/* Expandable details */}
            <Collapse in={isExpanded}>
              <Divider />
              <Box sx={{ p: 2 }}>

                {/* Items list */}
                {items.map((it, i) => {
                  const isDelivered = it.deliveryStatus === 'delivered'
                  const isFailed = it.deliveryStatus === 'failed'
                  return (
                    <Box
                      key={it.orderId}
                      sx={{
                        py: 1.5,
                        borderBottom: i < items.length - 1 ? '1px solid #f1f5f9' : 'none',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 1,
                        background: isDelivered ? '#f0fdf4' : isFailed ? '#fef2f2' : 'transparent',
                        borderRadius: 1,
                        px: 1,
                      }}
                    >
                      <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" fontWeight={600}>{it.customerName}</Typography>
                        <Typography variant="caption" color="text.secondary">{it.customerPhone}</Typography>
                        {it.deliveryAddress && (
                          <Typography variant="caption" display="block" color="text.secondary">
                            📍 {it.deliveryAddress}
                          </Typography>
                        )}
                        <Box sx={{ mt: 0.5 }}>
                          {(it.products || []).map((p: any, pi: number) => (
                            <Typography key={pi} variant="caption" display="block">
                              {p.productName} × {p.quantity}
                            </Typography>
                          ))}
                        </Box>
                        {it.deliveredAt && (
                          <Typography variant="caption" sx={{ color: isDelivered ? '#16a34a' : '#dc2626', fontWeight: 600, mt: 0.5, display: 'block' }}>
                            {isDelivered ? '✓ Delivered' : '✗ Failed'} · {new Date(it.deliveredAt).toLocaleString()}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
                        <Chip
                          icon={isDelivered ? <CheckCircleIcon /> : undefined}
                          label={isDelivered ? 'Delivered' : isFailed ? 'Failed' : 'Pending'}
                          color={isDelivered ? 'success' : isFailed ? 'error' : 'default'}
                          size="small"
                        />
                        {it.deliveryStatus === 'pending' && assignment.status !== 'completed' && (
                          <Tooltip title="Unassign this order">
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => removeItem(assignment, it.orderId, it.customerName)}
                              sx={{ p: 0.25 }}
                            >
                              <RemoveCircleOutlineIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    </Box>
                  )
                })}

                {/* Confirm Deliveries button */}
                {canConfirm && (
                  <Box sx={{ mt: 2 }}>
                    <Button
                      variant="contained"
                      color="success"
                      fullWidth
                      disabled={isReconciling}
                      onClick={() => reconcile(assignment)}
                      startIcon={isReconciling ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon />}
                      sx={{ py: 1.5 }}
                    >
                      {isReconciling
                        ? 'Confirming...'
                        : `Confirm ${deliveredCount} Delivered Order(s) — Mark in System`}
                    </Button>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, textAlign: 'center' }}>
                      Updates the Orders list with delivery date + "{assignment.deliveryCompanyName}"
                    </Typography>
                  </Box>
                )}

                {assignment.status === 'completed' && (
                  <Box sx={{ mt: 1.5, p: 1.5, background: '#d1fae5', borderRadius: 1, textAlign: 'center' }}>
                    <Typography variant="body2" color="success.dark" fontWeight={600}>
                      All confirmed — assignment complete
                    </Typography>
                  </Box>
                )}

                <Divider sx={{ my: 2 }} />

                {/* URLs section */}
                <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Share With Delivery Company
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
                  {/* Driver URL */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, background: '#f8fafc', borderRadius: 1, p: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary" display="block">Driver URL (web)</Typography>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace', fontWeight: 600, wordBreak: 'break-all' }}>
                        {webUrl}
                      </Typography>
                    </Box>
                    <Tooltip title="Copy driver URL">
                      <IconButton size="small" onClick={() => copyText(webUrl, 'Driver URL')}>
                        <ContentCopyIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Open driver URL">
                      <IconButton size="small" onClick={() => window.open(webUrl, '_blank')}>
                        <OpenInNewIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>

                  {/* API URL for software */}
                  <Box sx={{ background: '#1e293b', borderRadius: 1, p: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                        API Integration (for software)
                      </Typography>
                      <Tooltip title="Copy API base URL">
                        <IconButton size="small" onClick={() => copyText(apiBase, 'API URL')} sx={{ color: 'rgba(255,255,255,0.7)' }}>
                          <ContentCopyIcon sx={{ fontSize: 13 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#7dd3fc', display: 'block', wordBreak: 'break-all' }}>
                      GET {apiBase}
                    </Typography>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', color: '#86efac', display: 'block', wordBreak: 'break-all', mt: 0.5 }}>
                      PUT {apiBase}/items/{'{orderId}'}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.4)', display: 'block', mt: 1, fontSize: 10 }}>
                      No auth header needed — shortCode is the credential
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Collapse>
          </Paper>
        )
      })}

      {/* Mobile FAB */}
      <Fab
        color="primary"
        sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1200 }}
        onClick={() => navigate('/delivery-assignments/new')}
      >
        <AddIcon />
      </Fab>
    </Box>
  )
}
