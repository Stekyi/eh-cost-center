import React, { useEffect, useMemo, useState } from 'react'
// ── MIGRATED to Neon compat layer ──
import { listDocs, createDoc, updateDocById, deleteDocById } from '../utils/dataClient'
import { useLiveCollection } from '../hooks/useLiveCollection'
import { current } from '../utils/authClient'
import type { GridColDef } from '@mui/x-data-grid'
import Modal from '../components/Modal'
import ResponsiveDataGrid from '../components/ResponsiveDataGrid'
import { DEFAULT_CUSTOMER_ALLERGIES, nextCode } from '../utils/customerSegments'

const PREFIX = 'ALG'

export default function CustomerAllergies() {
  const { docs: items, refresh } = useLiveCollection('customerAllergies')
  const [search, setSearch] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [label, setLabel] = useState('')

  useEffect(() => {
    async function ensureDefaults() {
      try {
        const user = await current()
        if (!user) return

        const rows = await listDocs('customerAllergies')
        const existingByLabel = new Set(rows.map((r) => String(r.label || '').trim().toLowerCase()))
        const existingCodes = rows.map((r) => String(r.code || ''))

        let next = nextCode(existingCodes, PREFIX)
        let nextNum = Number(next.slice(PREFIX.length))
        let created = false

        for (const defaultLabel of DEFAULT_CUSTOMER_ALLERGIES) {
          const key = defaultLabel.trim().toLowerCase()
          if (existingByLabel.has(key)) continue

          const code = `${PREFIX}${String(nextNum).padStart(3, '0')}`
          nextNum += 1

          await createDoc('customerAllergies', {
            code,
            label: defaultLabel,
            active: true,
          })
          existingByLabel.add(key)
          created = true
        }
        if (created) refresh()
      } catch (err) {
        console.error('CustomerAllergies:ensureDefaults failed', err)
      }
    }
    ensureDefaults()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function createItem(e?: React.FormEvent) {
    e?.preventDefault()
    if (!label.trim()) return alert('Name is required')

    try {
      const code = nextCode(items.map((r) => String(r.code || '')), PREFIX)
      await createDoc('customerAllergies', {
        code,
        label: label.trim(),
        active: true,
      })
      setLabel('')
      setIsModalOpen(false)
      refresh()
    } catch (err: any) {
      console.error('CustomerAllergies:create failed', err)
      alert(err?.message || 'Failed to create allergy')
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editing?.id) return
    if (!String(editing.label || '').trim()) return alert('Name is required')

    try {
      await updateDocById('customerAllergies', editing.id, {
        label: String(editing.label || '').trim(),
        active: editing.active !== false,
      })
      setEditing(null)
      refresh()
    } catch (err: any) {
      console.error('CustomerAllergies:saveEdit failed', err)
      alert(err?.message || 'Failed to update allergy')
    }
  }

  async function removeItem(id: string) {
    if (!window.confirm('Delete customer allergy?')) return
    try {
      await deleteDocById('customerAllergies', id)
      refresh()
    } catch (err: any) {
      console.error('CustomerAllergies:delete failed', err)
      alert(err?.message || 'Failed to delete allergy')
    }
  }

  const rows = useMemo(() => {
    const q = String(search || '').trim().toLowerCase()
    return items
      .filter((r) => !!r.id)
      .filter((r) => {
        if (!q) return true
        return String(r.label || '').toLowerCase().includes(q) || String(r.code || '').toLowerCase().includes(q)
      })
      .map((r) => ({ id: r.id, code: r.code, label: r.label, active: r.active !== false }))
      .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')))
  }, [items, search])

  const columns = [
    { field: 'label', headerName: 'Allergy Name', flex: 1, minWidth: 220 },
    { field: 'code', headerName: 'Code', width: 130 },
    {
      field: 'active',
      headerName: 'Status',
      width: 120,
      valueGetter: (_v: any, row: any) => (row.active ? 'Active' : 'Inactive'),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 180,
      sortable: false,
      filterable: false,
      renderCell: (params: any) => (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" type="button" onClick={() => setEditing(params.row)}>Edit</button>
          <button className="btn btn-danger" type="button" onClick={() => removeItem(params.row.id)}>Delete</button>
        </div>
      ),
    },
  ] as GridColDef<any>[]

  return (
    <div className="page-container">
      <div className="header">
        <h1>Customer Allergies</h1>
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>Add Allergy</button>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            className="input"
            placeholder="Search by name or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 260 }}
          />
          <button className="btn" type="button" onClick={() => setSearch('')}>Reset</button>
        </div>

        <ResponsiveDataGrid
          rows={rows}
          columns={columns}
          onRowOpen={(row: any) => setEditing(row)}
          cardTitle={(row: any) => row.label}
          cardFields={[
            { label: 'Code', value: (row: any) => row.code },
            { label: 'Status', value: (row: any) => (row.active ? 'Active' : 'Inactive') },
          ]}
          cardActions={(row: any) => (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" type="button" onClick={() => setEditing(row)}>Edit</button>
              <button className="btn btn-danger" type="button" onClick={() => removeItem(row.id)}>Delete</button>
            </div>
          )}
        />
      </div>

      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)}>
        <h2>Add Customer Allergy</h2>
        <form onSubmit={createItem}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <label>Name</label>
              <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required />
            </div>
            <div>
              <button type="submit" className="btn btn-primary">Create</button>
            </div>
          </div>
        </form>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)}>
        <h2>Edit Customer Allergy</h2>
        <form onSubmit={saveEdit}>
          <div style={{ display: 'grid', gap: 10 }}>
            <div>
              <label>Name</label>
              <input
                className="input"
                value={editing?.label || ''}
                onChange={(e) => setEditing(editing ? { ...editing, label: e.target.value } : null)}
                required
              />
            </div>
            <div>
              <label>Code</label>
              <input className="input" value={editing?.code || ''} readOnly disabled style={{ backgroundColor: '#f5f5f5' }} />
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={editing?.active !== false}
                  onChange={(e) => setEditing(editing ? { ...editing, active: e.target.checked } : null)}
                />
                Active
              </label>
            </div>
            <div>
              <button type="submit" className="btn btn-primary">Save</button>
            </div>
          </div>
        </form>
      </Modal>
    </div>
  )
}
