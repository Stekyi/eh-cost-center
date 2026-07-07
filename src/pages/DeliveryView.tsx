import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Box,
  Paper,
  Typography,
  Button,
  Chip,
  CircularProgress,
  Divider,
} from '@mui/material'
import LocalShippingIcon from '@mui/icons-material/LocalShipping'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import { callApi } from '../utils/dataClient'
import { useSnackbar } from '../hooks/useSnackbar'
import { useConfirmDialog } from '../hooks/useConfirmDialog'

export default function DeliveryView() {
  const { shortCode } = useParams<{ shortCode: string }>()
  const [assignment, setAssignment] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState<string | null>(null)
  const { showSuccess, showError, SnackbarElement } = useSnackbar()
  const { confirm, ConfirmElement } = useConfirmDialog()

  useEffect(() => {
    if (!shortCode) return
    async function load() {
      setLoading(true)
      try {
        const data = await callApi(`/delivery/${shortCode}`, { method: 'GET' })
        setAssignment(data)
      } catch (err: any) {
        setError(err?.message || 'Failed to load delivery list')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [shortCode])

  async function markItem(orderId: string, status: 'delivered' | 'failed') {
    const label = status === 'delivered' ? 'Mark as Delivered' : 'Mark as Failed'
    const confirmed = await confirm(
      `Are you sure you want to ${status === 'delivered' ? 'mark this order as delivered' : 'mark this order as failed'}?`,
      label,
    )
    if (!confirmed) return

    setUpdating(orderId)
    try {
      await callApi(`/delivery/${shortCode}/items/${orderId}`, {
        method: 'PUT',
        body: { deliveryStatus: status, deliveredAt: new Date().toISOString() },
      })
      // Update local state
      setAssignment((prev: any) => ({
        ...prev,
        items: (prev.items || []).map((it: any) =>
          it.orderId === orderId
            ? { ...it, deliveryStatus: status, deliveredAt: new Date().toISOString() }
            : it,
        ),
      }))
      showSuccess(status === 'delivered' ? 'Marked as delivered!' : 'Marked as failed.')
    } catch (err: any) {
      showError(err?.message || 'Update failed')
    } finally {
      setUpdating(null)
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error || !assignment) {
    return (
      <Box sx={{ maxWidth: 480, mx: 'auto', p: 3, textAlign: 'center' }}>
        <Typography variant="h5" color="error" gutterBottom>Delivery List Not Found</Typography>
        <Typography color="text.secondary">{error || 'Invalid or expired delivery code.'}</Typography>
      </Box>
    )
  }

  const deliveredCount = (assignment.items || []).filter((it: any) => it.deliveryStatus === 'delivered').length
  const totalCount = (assignment.items || []).length

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', p: { xs: 1.5, sm: 3 }, pb: 5 }}>
      {SnackbarElement}
      {ConfirmElement}

      {/* Header */}
      <Paper sx={{ p: 2.5, mb: 2, background: '#1e293b', color: '#fff', borderRadius: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <LocalShippingIcon sx={{ fontSize: 32 }} />
          <Box>
            <Typography variant="h5" fontWeight={700}>Delivery List</Typography>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>{assignment.deliveryCompanyName}</Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 1.5 }}>
          <Chip
            label={`${deliveredCount} / ${totalCount} delivered`}
            size="small"
            sx={{ background: '#10b981', color: '#fff', fontWeight: 600 }}
          />
          <Chip
            label={`Code: ${shortCode}`}
            size="small"
            sx={{ background: 'rgba(255,255,255,0.15)', color: '#fff', fontFamily: 'monospace' }}
          />
        </Box>
        {assignment.notes && (
          <Typography variant="body2" sx={{ mt: 1.5, opacity: 0.8 }}>Note: {assignment.notes}</Typography>
        )}
      </Paper>

      {/* Items */}
      {(assignment.items || []).map((item: any, i: number) => {
        const isDone = item.deliveryStatus !== 'pending'
        const isDelivered = item.deliveryStatus === 'delivered'
        const isFailed = item.deliveryStatus === 'failed'
        const isUpdating = updating === item.orderId

        return (
          <Paper
            key={item.orderId}
            sx={{
              p: 2.5,
              mb: 1.5,
              borderRadius: 2,
              border: isDelivered ? '2px solid #10b981' : isFailed ? '2px solid #ef4444' : '1px solid #e5e7eb',
              background: isDelivered ? '#f0fdf4' : isFailed ? '#fef2f2' : '#fff',
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
              <Box>
                <Typography fontWeight={700} variant="h6">{item.customerName}</Typography>
                <Typography variant="body2" color="text.secondary">{item.customerPhone}</Typography>
                {item.deliveryAddress && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    📍 {item.deliveryAddress}
                  </Typography>
                )}
              </Box>
              {isDone && (
                <Chip
                  icon={isDelivered ? <CheckCircleIcon /> : <CancelIcon />}
                  label={isDelivered ? 'Delivered' : 'Failed'}
                  color={isDelivered ? 'success' : 'error'}
                  size="small"
                />
              )}
            </Box>

            <Divider sx={{ mb: 1.5 }} />

            {/* Products */}
            <Box sx={{ mb: 1.5 }}>
              {(item.products || []).map((p: any, pi: number) => (
                <Box key={pi} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
                  <Typography variant="body2" fontWeight={500}>{p.productName}</Typography>
                  <Typography variant="body2" color="text.secondary">× {p.quantity}</Typography>
                </Box>
              ))}
            </Box>

            {/* Actions */}
            {!isDone && (
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="contained"
                  color="success"
                  fullWidth
                  disabled={isUpdating}
                  onClick={() => markItem(item.orderId, 'delivered')}
                  startIcon={isUpdating ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon />}
                  sx={{ py: 1.5 }}
                >
                  {isUpdating ? 'Updating...' : 'Mark Delivered'}
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  disabled={isUpdating}
                  onClick={() => markItem(item.orderId, 'failed')}
                  sx={{ minWidth: 80, py: 1.5 }}
                >
                  Failed
                </Button>
              </Box>
            )}

            {isDone && item.deliveredAt && (
              <Typography variant="caption" color="text.secondary">
                {isDelivered ? 'Delivered' : 'Failed'} at:{' '}
                {new Date(item.deliveredAt).toLocaleString()}
              </Typography>
            )}
          </Paper>
        )
      })}

      {totalCount === 0 && (
        <Box sx={{ py: 6, textAlign: 'center', color: '#94a3b8' }}>
          <Typography>No deliveries in this batch.</Typography>
        </Box>
      )}

      {deliveredCount === totalCount && totalCount > 0 && (
        <Paper sx={{ p: 2.5, background: '#d1fae5', border: '2px solid #10b981', textAlign: 'center', borderRadius: 2, mt: 2 }}>
          <CheckCircleIcon sx={{ fontSize: 48, color: '#10b981', mb: 1 }} />
          <Typography variant="h6" fontWeight={700} color="success.dark">All deliveries complete!</Typography>
          <Typography variant="body2" color="success.dark">Thank you for completing this delivery run.</Typography>
        </Paper>
      )}
    </Box>
  )
}
