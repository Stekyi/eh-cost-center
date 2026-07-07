import React, { useEffect, useState } from 'react'
import {
  Box, Typography, Button, TextField, MenuItem, Dialog, DialogTitle, DialogContent,
  DialogActions, Switch, CircularProgress, Chip,
} from '@mui/material'
import { callApi } from '../utils/dataClient'
import { useSnackbar } from '../hooks/useSnackbar'

const ROLES = ['admin', 'assistant', 'videographer'] as const

interface UserRow {
  uid: string
  email: string
  role: string | null
  disabled: boolean
  has_password: boolean
  created_at?: string
}

export default function UsersAdmin() {
  const { showError, showSuccess, SnackbarElement } = useSnackbar()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  // create form
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<string>('assistant')
  const [newPassword, setNewPassword] = useState('')
  const [creating, setCreating] = useState(false)

  // reset-password dialog
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null)
  const [resetPassword, setResetPassword] = useState('')

  async function load() {
    setLoading(true)
    try { setUsers(await callApi('/api/users', { method: 'GET' })) }
    catch (e: any) { showError(e?.message || 'Failed to load users') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function createUser(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmail.includes('@')) { showError('Enter a valid email'); return }
    if (newPassword && newPassword.length < 8) { showError('Password must be 8+ characters'); return }
    setCreating(true)
    try {
      await callApi('/api/users', { body: { email: newEmail.trim(), role: newRole, password: newPassword || undefined } })
      showSuccess(`User ${newEmail} created`)
      setNewEmail(''); setNewPassword(''); setNewRole('assistant')
      load()
    } catch (e: any) { showError(e?.message || 'Create failed') }
    finally { setCreating(false) }
  }

  async function patchUser(u: UserRow, changes: { role?: string | null; disabled?: boolean }) {
    setBusy(u.uid)
    try { await callApi(`/api/users/${u.uid}`, { method: 'PATCH', body: changes }); await load() }
    catch (e: any) { showError(e?.message || 'Update failed') }
    finally { setBusy(null) }
  }

  async function doResetPassword() {
    if (!resetTarget) return
    if (resetPassword.length < 8) { showError('Password must be 8+ characters'); return }
    setBusy(resetTarget.uid)
    try {
      await callApi(`/api/users/${resetTarget.uid}/set-password`, { body: { password: resetPassword } })
      showSuccess(`Password set for ${resetTarget.email}. They can change it any time.`)
      setResetTarget(null); setResetPassword(''); load()
    } catch (e: any) { showError(e?.message || 'Reset failed') }
    finally { setBusy(null) }
  }

  return (
    <div className="card" style={{ maxWidth: '100%', width: '100%' }}>
      {SnackbarElement}
      <h2>User Management</h2>

      {/* Create user */}
      <Box component="form" onSubmit={createUser}
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1.5fr auto' }, gap: 1.5, alignItems: 'center', mb: 3 }}>
        <TextField label="Email" size="small" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} type="email" />
        <TextField label="Role" size="small" select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
          {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
        </TextField>
        <TextField label="Default password (optional)" size="small" value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)} type="text" placeholder="8+ chars, or set later" />
        <Button type="submit" variant="contained" disabled={creating}
          startIcon={creating ? <CircularProgress size={16} color="inherit" /> : undefined}>Add User</Button>
      </Box>

      {loading ? <CircularProgress /> : (
        <Box sx={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e9ecef' }}>
                <th style={{ padding: 8 }}>Email</th>
                <th style={{ padding: 8 }}>Role</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Password</th>
                <th style={{ padding: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.uid} style={{ borderBottom: '1px solid #f1f3f5', opacity: u.disabled ? 0.55 : 1 }}>
                  <td style={{ padding: 8 }}>{u.email}</td>
                  <td style={{ padding: 8 }}>
                    <TextField select size="small" value={u.role || ''} disabled={busy === u.uid}
                      onChange={(e) => patchUser(u, { role: e.target.value || null })} sx={{ minWidth: 140 }}>
                      <MenuItem value=""><em>none</em></MenuItem>
                      {ROLES.map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
                    </TextField>
                  </td>
                  <td style={{ padding: 8 }}>
                    <Switch checked={!u.disabled} disabled={busy === u.uid}
                      onChange={(e) => patchUser(u, { disabled: !e.target.checked })} />
                    <span>{u.disabled ? 'Deactivated' : 'Active'}</span>
                  </td>
                  <td style={{ padding: 8 }}>
                    {u.has_password
                      ? <Chip label="set" size="small" color="success" variant="outlined" />
                      : <Chip label="not set" size="small" color="warning" variant="outlined" />}
                  </td>
                  <td style={{ padding: 8 }}>
                    <Button size="small" variant="outlined" disabled={busy === u.uid}
                      onClick={() => { setResetTarget(u); setResetPassword('') }}>Reset / set password</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}

      {/* Reset password dialog */}
      <Dialog open={!!resetTarget} onClose={() => setResetTarget(null)} fullWidth maxWidth="xs">
        <DialogTitle>Set a default password</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            For <b>{resetTarget?.email}</b>. They can keep it or change it later — no email is sent.
          </Typography>
          <TextField autoFocus fullWidth size="small" label="New password" type="text"
            value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} placeholder="8+ characters" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetTarget(null)}>Cancel</Button>
          <Button variant="contained" onClick={doResetPassword}
            disabled={busy === resetTarget?.uid}>Set password</Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
