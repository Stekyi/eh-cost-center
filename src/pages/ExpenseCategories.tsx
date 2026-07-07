import React, { useState } from 'react'
// ── MIGRATED to Neon compat layer ──
// Was: import { db, auth } from '../utils/firebaseClient'
//      import { collection, addDoc, onSnapshot, query, deleteDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { createDoc, updateDocById, deleteDocById } from '../utils/dataClient'
import { useLiveCollection } from '../hooks/useLiveCollection'
import ResponsiveDataGrid from '../components/ResponsiveDataGrid'
import * as XLSX from 'xlsx'
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  Fab,
  useTheme,
  useMediaQuery,
  MenuItem,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { useSnackbar } from '../hooks/useSnackbar'
import { useConfirmDialog } from '../hooks/useConfirmDialog'

export default function ExpenseCategories() {
  const { docs: cats, refresh } = useLiveCollection('expenseCategories')
  const [label, setLabel] = useState('')
  const [type, setType] = useState<'variable' | 'fixed'>('variable')
  const [filterName, setFilterName] = useState('')
  const [filterType, setFilterType] = useState<string>('all')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)

  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const { showSuccess, showError, SnackbarElement } = useSnackbar()
  const { confirm, ConfirmElement } = useConfirmDialog()

  async function generateUniqueCode(): Promise<string> {
    const existingCodes = cats.map(c => c.code)
    let code: string
    let attempts = 0
    do {
      const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
      code = `EXP${randomNum}`
      attempts++
      if (attempts > 100) throw new Error('Unable to generate unique code after 100 attempts')
    } while (existingCodes.includes(code))
    return code
  }

  async function createCategory(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (!label.trim()) { showError('Label is required'); return }
    setSaving(true)
    try {
      const code = await generateUniqueCode()
      await createDoc('expenseCategories', {
        label: label.trim(),
        code,
        type,
      })
      setLabel('')
      setType('variable')
      setIsAddOpen(false)
      showSuccess('Category created!')
      refresh()
    } catch (err: any) {
      showError(err?.message || 'Failed to create category')
    } finally {
      setSaving(false)
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editing) return
    if (!editing.label?.trim()) { showError('Label is required'); return }
    setSaving(true)
    try {
      await updateDocById('expenseCategories', editing.id, {
        label: editing.label.trim(),
        type: editing.type || 'variable',
      })
      setEditing(null)
      showSuccess('Category updated!')
      refresh()
    } catch (err: any) {
      showError(err?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    const ok = await confirm('Delete this expense category? This cannot be undone.', 'Delete Category')
    if (!ok) return
    try {
      await deleteDocById('expenseCategories', id)
      showSuccess('Category deleted.')
      refresh()
    } catch (err: any) {
      showError(err?.message || 'Failed to delete')
    }
  }

  const filteredRows = React.useMemo(() => {
    const q = String(filterName || '').trim().toLowerCase()
    return cats
      .filter((c) => !!c?.id)
      .filter((c) => (filterType === 'all' ? true : String(c.type || '').toLowerCase() === String(filterType || '').toLowerCase()))
      .filter((c) => (q ? String(c.label || '').toLowerCase().includes(q) : true))
      .map(c => ({ id: c.id, label: c.label, code: c.code, type: c.type }))
  }, [cats, filterName, filterType])

  function exportFilteredCategories() {
    try {
      const data = filteredRows.map(({ id, ...rest }: any) => ({ id, ...rest }))
      const ws = XLSX.utils.json_to_sheet(data)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'ExpenseCategories')
      XLSX.writeFile(wb, `expense_categories_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (err) {
      showError('Failed to export categories')
    }
  }

  const columns = [
    { field: 'label', headerName: 'Label', flex: 1, minWidth: 160 },
    { field: 'code', headerName: 'Code', width: 140 },
    { field: 'type', headerName: 'Type', width: 120, valueFormatter: (value: string) => value ? value.charAt(0).toUpperCase() + value.slice(1) : '' },
    {
      field: 'actions', headerName: 'Actions', width: 180, sortable: false, filterable: false,
      renderCell: (params: any) => (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="outlined" onClick={() => setEditing({ ...params.row, type: params.row.type || 'variable' })}>Edit</Button>
          <Button size="small" variant="outlined" color="error" onClick={() => remove(params.row.id)}>Delete</Button>
        </Box>
      )
    }
  ]

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', p: { xs: 1.5, sm: 3 }, pb: 10 }}>
      {SnackbarElement}
      {ConfirmElement}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Expense Categories</Typography>
          <Typography variant="body2" color="text.secondary">{cats.length} categories</Typography>
        </Box>
        {!isMobile && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setIsAddOpen(true)}>
            Add Category
          </Button>
        )}
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search label"
          value={filterName}
          onChange={(e) => setFilterName(e.target.value)}
          sx={{ minWidth: 180 }}
        />
        <TextField
          select
          size="small"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          sx={{ minWidth: 120 }}
        >
          <MenuItem value="all">All Types</MenuItem>
          <MenuItem value="variable">Variable</MenuItem>
          <MenuItem value="fixed">Fixed</MenuItem>
        </TextField>
        <Button size="small" variant="outlined" onClick={exportFilteredCategories}>Export</Button>
        <Button size="small" onClick={() => { setFilterName(''); setFilterType('all') }}>Reset</Button>
      </Box>

      <ResponsiveDataGrid
        rows={filteredRows}
        columns={columns}
        onRowOpen={(r: any) => setEditing({ ...r, type: r.type || 'variable' })}
        cardTitle={(r: any) => r.label}
        cardFields={[
          { label: 'Code', value: (row: any) => row.code },
          { label: 'Type', value: (row: any) => row.type ? row.type.charAt(0).toUpperCase() + row.type.slice(1) : '' },
        ]}
        cardActions={(r: any) => (
          <Button size="small" color="error" onClick={(e) => { e.stopPropagation(); remove(r.id) }}>Delete</Button>
        )}
      />

      {/* Mobile FAB */}
      {isMobile && (
        <Fab color="primary" sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1200 }} onClick={() => setIsAddOpen(true)}>
          <AddIcon />
        </Fab>
      )}

      {/* Add Dialog */}
      <Dialog open={isAddOpen} onClose={() => setIsAddOpen(false)} fullScreen={isMobile} fullWidth maxWidth="xs">
        <DialogTitle>Add Expense Category</DialogTitle>
        <form onSubmit={createCategory}>
          <DialogContent dividers>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Label *"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                fullWidth
                size="small"
                autoFocus
              />
              <TextField
                select
                label="Type *"
                value={type}
                onChange={(e) => setType(e.target.value as 'variable' | 'fixed')}
                fullWidth
                size="small"
              >
                <MenuItem value="variable">Variable</MenuItem>
                <MenuItem value="fixed">Fixed</MenuItem>
              </TextField>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setIsAddOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? 'Creating...' : 'Create'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editing} onClose={() => setEditing(null)} fullScreen={isMobile} fullWidth maxWidth="xs">
        <DialogTitle>Edit Category</DialogTitle>
        <form onSubmit={saveEdit}>
          <DialogContent dividers>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Label *"
                value={editing?.label || ''}
                onChange={(e) => setEditing((prev: any) => prev ? { ...prev, label: e.target.value } : null)}
                fullWidth
                size="small"
                autoFocus
              />
              <TextField
                label="Code"
                value={editing?.code || ''}
                fullWidth
                size="small"
                disabled
                helperText="Auto-generated, cannot be changed"
              />
              <TextField
                select
                label="Type *"
                value={editing?.type || 'variable'}
                onChange={(e) => setEditing((prev: any) => prev ? { ...prev, type: e.target.value } : null)}
                fullWidth
                size="small"
              >
                <MenuItem value="variable">Variable</MenuItem>
                <MenuItem value="fixed">Fixed</MenuItem>
              </TextField>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  )
}
