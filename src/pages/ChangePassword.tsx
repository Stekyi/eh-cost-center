import React, { useState } from 'react'
import { Box, TextField, Button, Typography, CircularProgress } from '@mui/material'
import { callApi } from '../utils/dataClient'
import { useSnackbar } from '../hooks/useSnackbar'

export default function ChangePassword() {
  const { showError, showSuccess, SnackbarElement } = useSnackbar()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (next.length < 8) { showError('New password must be at least 8 characters'); return }
    if (next !== confirm) { showError('New passwords do not match'); return }
    setSaving(true)
    try {
      await callApi('/api/auth/change-password', { body: { currentPassword: current, newPassword: next } })
      showSuccess('Password changed successfully')
      setCurrent(''); setNext(''); setConfirm('')
    } catch (e: any) {
      showError(e?.message === 'current_password_incorrect' ? 'Current password is incorrect' : (e?.message || 'Change failed'))
    } finally { setSaving(false) }
  }

  return (
    <div className="card" style={{ maxWidth: 480, width: '100%' }}>
      {SnackbarElement}
      <h2>Change Password</h2>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Set a new password for your account. Takes effect immediately.
      </Typography>
      <Box component="form" onSubmit={submit} sx={{ display: 'grid', gap: 2 }}>
        <TextField label="Current password" type="password" size="small" value={current}
          onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        <TextField label="New password" type="password" size="small" value={next}
          onChange={(e) => setNext(e.target.value)} autoComplete="new-password" helperText="At least 8 characters" />
        <TextField label="Confirm new password" type="password" size="small" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        <Button type="submit" variant="contained" disabled={saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}>
          {saving ? 'Saving…' : 'Change Password'}
        </Button>
      </Box>
    </div>
  )
}
