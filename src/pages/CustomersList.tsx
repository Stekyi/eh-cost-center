import React, { useState } from 'react'
// ── MIGRATED to Neon compat layer ──
import { listDocs, updateDocById, deleteDocById } from '../utils/dataClient'
import { useLiveCollection } from '../hooks/useLiveCollection'
import {
  Box,
  useTheme,
  useMediaQuery,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Chip,
  Typography,
  Fab,
  CircularProgress,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import type { GridColDef } from '@mui/x-data-grid'
import ResponsiveDataGrid from '../components/ResponsiveDataGrid'
import CreateCustomerModal from '../components/CreateCustomerModal'
import { toLabelsText } from '../utils/customerSegments'
import { useSnackbar } from '../hooks/useSnackbar'
import { useConfirmDialog } from '../hooks/useConfirmDialog'
import { useRole } from '../utils/RoleContext'

type Customer = {
  id?: string
  name: string
  telephone1?: string
  telephone2?: string
  dob?: string
  city?: string
  deliveryAddress1?: string
  deliveryAddress2?: string
  profile?: string
  categoryCodes?: string[]
  allergyCodes?: string[]
}

const styles = {
  page: {
    minHeight: 'calc(100vh - 80px)',
    background: 'linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%)',
    padding: '24px',
  } as React.CSSProperties,
  container: {
    width: '100%',
    maxWidth: '100%',
    margin: '0 auto',
  } as React.CSSProperties,
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  } as React.CSSProperties,
  title: {
    fontSize: 28,
    fontWeight: 700,
    color: '#1e293b',
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  } as React.CSSProperties,
  badge: {
    background: '#2563eb',
    color: '#fff',
    fontSize: 14,
    padding: '4px 12px',
    borderRadius: 20,
    fontWeight: 500,
  } as React.CSSProperties,
  grid: {
    display: 'flex',
    gap: 24,
    alignItems: 'start',
    flexDirection: 'row' as const,
  } as React.CSSProperties,
  formCard: {
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    padding: 24,
    minWidth: 0,
  } as React.CSSProperties,
  formTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: 20,
    paddingBottom: 12,
    borderBottom: '2px solid #e5e7eb',
  } as React.CSSProperties,
  formGroup: {
    marginBottom: 16,
  } as React.CSSProperties,
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: '#64748b',
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  } as React.CSSProperties,
  input: {
    width: '100%',
    padding: '12px 14px',
    border: '2px solid #e5e7eb',
    borderRadius: 10,
    fontSize: 15,
    transition: 'all 0.2s',
    outline: 'none',
    background: '#fafbfc',
  } as React.CSSProperties,
  textarea: {
    width: '100%',
    padding: '12px 14px',
    border: '2px solid #e5e7eb',
    borderRadius: 10,
    fontSize: 15,
    minHeight: 80,
    resize: 'vertical' as const,
    outline: 'none',
    background: '#fafbfc',
  } as React.CSSProperties,
  submitBtn: {
    width: '100%',
    padding: '14px 20px',
    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 8,
    transition: 'transform 0.2s, box-shadow 0.2s',
    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
  } as React.CSSProperties,
  tableCard: {
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    overflow: 'hidden',
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,
  tableHeader: {
    padding: '16px 20px',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  } as React.CSSProperties,
  tableTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#1e293b',
  } as React.CSSProperties,
  tableScroll: {
    maxHeight: 600,
    overflowY: 'auto' as const,
  } as React.CSSProperties,
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  } as React.CSSProperties,
  th: {
    padding: '14px 16px',
    textAlign: 'left' as const,
    fontSize: 12,
    fontWeight: 600,
    color: '#64748b',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    background: '#f8fafc',
    borderBottom: '2px solid #e5e7eb',
    position: 'sticky' as const,
    top: 0,
  } as React.CSSProperties,
  td: {
    padding: '14px 16px',
    fontSize: 14,
    color: '#334155',
    borderBottom: '1px solid #f1f5f9',
  } as React.CSSProperties,
  nameCell: {
    fontWeight: 600,
    color: '#1e293b',
  } as React.CSSProperties,
  actionBtn: {
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    marginRight: 6,
    transition: 'all 0.2s',
  } as React.CSSProperties,
  editBtn: {
    background: '#f0f9ff',
    color: '#0284c7',
  } as React.CSSProperties,
  deleteBtn: {
    background: '#fef2f2',
    color: '#dc2626',
  } as React.CSSProperties,
  emptyState: {
    padding: 40,
    textAlign: 'center' as const,
    color: '#94a3b8',
  } as React.CSSProperties,
  modal: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(15, 23, 42, 0.6)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 16,
  } as React.CSSProperties,
  modalCard: {
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
    padding: 28,
    width: '100%',
    maxWidth: 440,
  } as React.CSSProperties,
  modalTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: 20,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  } as React.CSSProperties,
  modalActions: {
    display: 'flex',
    gap: 10,
    marginTop: 20,
  } as React.CSSProperties,
  saveBtn: {
    flex: 1,
    padding: '12px 20px',
    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
  } as React.CSSProperties,
  cancelBtn: {
    flex: 1,
    padding: '12px 20px',
    background: '#f1f5f9',
    color: '#64748b',
    border: 'none',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 500,
    cursor: 'pointer',
  } as React.CSSProperties,
}

export default function CustomersList() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const { showSuccess, showError, SnackbarElement } = useSnackbar()
  const { confirm, ConfirmElement } = useConfirmDialog()
  const role = useRole()
  const canDelete = role === 'admin'

  const [editCustomer, setEditCustomer] = useState<Customer|null>(null)
  // onSnapshot → polling hooks. `refreshCustomers` re-fetches after a mutation.
  const { docs: customers, refresh: refreshCustomers } = useLiveCollection('customers', { orderBy: { field: 'name' } })
  const { docs: categoryRows } = useLiveCollection('customerCategories')
  const { docs: allergyRows } = useLiveCollection('customerAllergies')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlightRowId, setHighlightRowId] = useState<string|number>('')

  const categoryLabelMap = React.useMemo(
    () => Object.fromEntries(categoryRows.map((r: any) => [String(r.code), String(r.label || r.code)])),
    [categoryRows],
  )
  const allergyLabelMap = React.useMemo(
    () => Object.fromEntries(allergyRows.map((r: any) => [String(r.code), String(r.label || r.code)])),
    [allergyRows],
  )
  async function canDeleteCustomer(id: string){
    try{
      const rows = await listDocs('orders', { where: [{ field: 'customerId', op: '==', value: id }], limit: 1 })
      return rows.length === 0
    }catch(e){
      console.error('canDeleteCustomer', e)
      return false
    }
  }

  async function removeCustomer(id?: string) {
    if (!id) return
    const confirmed = await confirm('Delete this customer?', 'Delete Customer')
    if (!confirmed) return
    const ok = await canDeleteCustomer(id)
    if (!ok) { showError('Cannot delete customer; referenced by existing orders'); return }
    try{
      await deleteDocById('customers', id)
      refreshCustomers()
      showSuccess('Customer deleted')
    }catch(e){
      console.error('removeCustomer', e)
      showError('Delete failed')
    }
  }

  const filtered = customers.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (String(c.name || '').toLowerCase().includes(q) || String(c.telephone1 || '').toLowerCase().includes(q) || String(c.telephone2 || '').toLowerCase().includes(q) || String(c.city || '').toLowerCase().includes(q))
  })
  const rows = filtered.filter((c) => !!c.id).map((c) => ({ id: c.id as string, ...c }))

  const columns = [
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 180 },
    {
      field: 'phone',
      headerName: 'Phone',
      flex: 1,
      minWidth: 160,
      valueGetter: (_v: any, row: any) => [row.telephone1, row.telephone2].filter(Boolean).join(' / ') || '-',
    },
    { field: 'city', headerName: 'City', width: 140, valueGetter: (_v: any, row: any) => row.city || '-' },
    {
      field: 'deliveryAddress1',
      headerName: 'Address',
      flex: 1,
      minWidth: 200,
      valueGetter: (_v: any, row: any) => row.deliveryAddress1 || '-',
    },
    {
      field: 'categories',
      headerName: 'Categories',
      flex: 1,
      minWidth: 220,
      valueGetter: (_v: any, row: any) => toLabelsText(row.categoryCodes, categoryLabelMap),
    },
    {
      field: 'allergies',
      headerName: 'Allergies',
      flex: 1,
      minWidth: 220,
      valueGetter: (_v: any, row: any) => toLabelsText(row.allergyCodes, allergyLabelMap),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 160,
      sortable: false,
      filterable: false,
      renderCell: (params: any) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ ...styles.actionBtn, ...styles.editBtn }} onClick={(e) => { e.stopPropagation(); setEditCustomer(params.row) }}>
            ✏️ Edit
          </button>
          {canDelete && (
            <button style={{ ...styles.actionBtn, ...styles.deleteBtn }} onClick={(e) => { e.stopPropagation(); removeCustomer(params.row.id) }}>
              🗑️
            </button>
          )}
        </div>
      ),
    },
  ] as GridColDef<any>[]

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, pb: isMobile ? 10 : 3 }}>
      {SnackbarElement}
      {ConfirmElement}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h5" fontWeight={700}>Customer Management</Typography>
          <Chip label={`${customers.length} total`} size="small" color="primary" />
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search customers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ width: { xs: '100%', sm: 220 } }}
          />
          {!isMobile && (
            <Button variant="contained" onClick={() => setIsCreateModalOpen(true)}>Add Customer</Button>
          )}
        </Box>
      </Box>

      {rows.length === 0 ? (
        <Box sx={{ py: 8, textAlign: 'center', color: '#94a3b8' }}>
          <Typography variant="h2" sx={{ mb: 1.5 }}>📭</Typography>
          <Typography>No customers yet. Add your first customer!</Typography>
        </Box>
      ) : (
        <ResponsiveDataGrid
          rows={rows}
          columns={columns}
          cardTitle={(row: any) => row.name}
          cardFields={[
            { label: 'Phone', value: (row: any) => [row.telephone1, row.telephone2].filter(Boolean).join(' / ') || '-' },
            { label: 'City', value: (row: any) => row.city || '-' },
            { label: 'Address', value: (row: any) => row.deliveryAddress1 || '-' },
            { label: 'Categories', value: (row: any) => toLabelsText(row.categoryCodes, categoryLabelMap) },
            { label: 'Allergies', value: (row: any) => toLabelsText(row.allergyCodes, allergyLabelMap) },
          ]}
          cardActions={(row: any) => (
            <Box sx={{ display: 'flex', gap: 1 }} onClick={(e) => e.stopPropagation()}>
              <Button size="small" variant="outlined" onClick={() => setEditCustomer(row)}>Edit</Button>
              {canDelete && <Button size="small" variant="outlined" color="error" onClick={() => removeCustomer(row.id)}>Delete</Button>}
            </Box>
          )}
          onRowOpen={(row: any) => setEditCustomer(row)}
          gridHeight={600}
          highlightRowId={highlightRowId}
        />
      )}

      {/* Mobile FAB */}
      {isMobile && (
        <Fab
          color="primary"
          sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1200 }}
          onClick={() => setIsCreateModalOpen(true)}
        >
          <AddIcon />
        </Fab>
      )}

      {/* Create Modal */}
      <CreateCustomerModal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={(id) => {
          refreshCustomers()
          setHighlightRowId(id)
          showSuccess('Customer created')
          setTimeout(() => setHighlightRowId(''), 2500)
        }}
      />

      {/* Edit Modal */}
      {editCustomer && (
        <EditCustomerModal
          customer={editCustomer}
          categoryRows={categoryRows}
          allergyRows={allergyRows}
          categoryLabelMap={categoryLabelMap}
          allergyLabelMap={allergyLabelMap}
          onClose={() => setEditCustomer(null)}
          onSaved={() => { refreshCustomers(); showSuccess('Customer updated') }}
        />
      )}
    </Box>
  )
}

function EditCustomerModal({
  customer,
  categoryRows,
  allergyRows,
  categoryLabelMap,
  allergyLabelMap,
  onClose,
  onSaved,
}: {
  customer: Customer
  categoryRows: any[]
  allergyRows: any[]
  categoryLabelMap: Record<string, string>
  allergyLabelMap: Record<string, string>
  onClose: () => void
  onSaved?: () => void
}) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))

  const [form, setForm] = useState({
    name: customer.name || '',
    telephone1: customer.telephone1 || '',
    telephone2: customer.telephone2 || '',
    dob: customer.dob || '',
    city: customer.city || '',
    deliveryAddress1: customer.deliveryAddress1 || '',
    deliveryAddress2: customer.deliveryAddress2 || '',
    profile: customer.profile || '',
    categoryCodes: customer.categoryCodes || [] as string[],
    allergyCodes: customer.allergyCodes || [] as string[],
  })
  const [saving, setSaving] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }))
  }

  function toggleCode(code: string, key: 'categoryCodes' | 'allergyCodes') {
    setForm((prev: any) => ({
      ...prev,
      [key]: prev[key].includes(code) ? prev[key].filter((x: string) => x !== code) : [...prev[key], code],
    }))
  }

  async function handleSave() {
    setSaving(true)
    if (!customer.id) { setSaving(false); return }
    try {
      await updateDocById('customers', customer.id, { ...form })
      onSaved && onSaved()
      onClose()
    } catch (e) {
      console.error('EditCustomerModal:save failed', e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={true}
      onClose={onClose}
      fullScreen={isMobile}
      maxWidth="md"
      fullWidth
      PaperProps={{ sx: { borderRadius: isMobile ? 0 : 3 } }}
    >
      <DialogTitle>
        <Typography variant="h6" fontWeight={700}>Edit Customer</Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2, pt: 0.5 }}>
          <Box sx={{ gridColumn: '1 / -1' }}>
            <TextField label="Full Name" name="name" value={form.name} onChange={handleChange} fullWidth size="small" />
          </Box>
          <TextField label="Phone 1" name="telephone1" value={form.telephone1} onChange={handleChange} fullWidth size="small" />
          <TextField label="Phone 2" name="telephone2" value={form.telephone2} onChange={handleChange} fullWidth size="small" />
          <TextField label="Date of Birth" name="dob" type="date" value={form.dob} onChange={handleChange} fullWidth size="small" InputLabelProps={{ shrink: true }} />
          <TextField label="City" name="city" value={form.city} onChange={handleChange} fullWidth size="small" />
          <Box sx={{ gridColumn: '1 / -1' }}>
            <TextField label="Delivery Address 1" name="deliveryAddress1" value={form.deliveryAddress1} onChange={handleChange} fullWidth size="small" />
          </Box>
          <Box sx={{ gridColumn: '1 / -1' }}>
            <TextField label="Delivery Address 2" name="deliveryAddress2" value={form.deliveryAddress2} onChange={handleChange} fullWidth size="small" />
          </Box>
          <Box sx={{ gridColumn: '1 / -1' }}>
            <TextField label="Profile Notes" name="profile" value={form.profile} onChange={handleChange} fullWidth size="small" multiline rows={2} />
          </Box>
          <Box sx={{ gridColumn: '1 / -1' }}>
            <Typography variant="body2" fontWeight={500} sx={{ mb: 1 }}>Customer Categories</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {categoryRows.filter((r) => r.active !== false).map((c) => (
                <Chip
                  key={c.id || c.code}
                  label={c.label}
                  size="small"
                  clickable
                  onClick={() => toggleCode(String(c.code), 'categoryCodes')}
                  variant={form.categoryCodes.includes(String(c.code)) ? 'filled' : 'outlined'}
                  color={form.categoryCodes.includes(String(c.code)) ? 'primary' : 'default'}
                />
              ))}
            </Box>
          </Box>
          <Box sx={{ gridColumn: '1 / -1' }}>
            <Typography variant="body2" fontWeight={500} sx={{ mb: 1 }}>Allergies</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {allergyRows.filter((r) => r.active !== false).map((a) => (
                <Chip
                  key={a.id || a.code}
                  label={a.label}
                  size="small"
                  clickable
                  onClick={() => toggleCode(String(a.code), 'allergyCodes')}
                  variant={form.allergyCodes.includes(String(a.code)) ? 'filled' : 'outlined'}
                  color={form.allergyCodes.includes(String(a.code)) ? 'error' : 'default'}
                />
              ))}
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
        <Button variant="outlined" onClick={onClose} fullWidth={isMobile}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          fullWidth={isMobile}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
