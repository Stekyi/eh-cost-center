import React, { useState } from 'react'
// ── MIGRATED to Neon compat layer (reference example) ──
// Was: import { db } from '../utils/firebaseClient'
//      import { collection, addDoc, onSnapshot, updateDoc, doc, deleteDoc } from 'firebase/firestore'
import { createDoc, updateDocById, deleteDocById } from '../utils/dataClient'
import { useLiveCollection } from '../hooks/useLiveCollection'
import { Box } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import ResponsiveDataGrid from '../components/ResponsiveDataGrid'
import Modal from '../components/Modal'

export default function StaffList(){
  // onSnapshot(collection(db,'staff'), …) → polling hook. `refresh` re-fetches
  // immediately after a mutation (no serverTimestamp/createdBy — the Worker stamps them).
  const { docs: staff, refresh } = useLiveCollection('staff')
  const [name, setName] = useState('')
  const [salary, setSalary] = useState<number>(0)
  const [editingStaff, setEditingStaff] = useState<any | null>(null)
  const [editName, setEditName] = useState('')
  const [editSalary, setEditSalary] = useState<number>(0)

  async function create(){
    if(!name) return
    await createDoc('staff', { name, salary: Number(salary), status: 'active' })
    setName('')
    setSalary(0)
    refresh()
  }

  async function toggleStatus(s:any){
    await updateDocById('staff', s.id, { status: s.status === 'active' ? 'inactive' : 'active' })
    refresh()
  }

  async function remove(s:any){
    if(!confirm('Delete staff?')) return
    await deleteDocById('staff', s.id)
    refresh()
  }

  function openEditStaff(s: any) {
    setEditingStaff(s)
    setEditName(s.name || '')
    setEditSalary(s.salary || 0)
  }

  async function saveEditStaff() {
    if (!editingStaff?.id) return
    await updateDocById('staff', editingStaff.id, { name: editName, salary: Number(editSalary) })
    setEditingStaff(null)
    refresh()
  }

  const rows = staff.filter((s) => !!s?.id)

  // Calculate totals
  const totalCount = rows.length
  const totalSalary = rows.reduce((sum, staff) => sum + (staff.salary || 0), 0)

  const columns = [
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 160 },
    {
      field: 'salary',
      headerName: 'Salary',
      width: 120,
      valueGetter: (_v: any, row: any) => row.salary ?? '-',
    },
    { field: 'status', headerName: 'Status', width: 120 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 180,
      sortable: false,
      filterable: false,
      renderCell: (params: any) => (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" type="button" onClick={(e) => { e.stopPropagation(); toggleStatus(params.row) }}>
            Toggle
          </button>
          <button className="btn btn-danger" type="button" onClick={(e) => { e.stopPropagation(); remove(params.row) }}>
            Delete
          </button>
        </div>
      ),
    },
  ] as GridColDef<any>[]

  return (
    <div className="card" style={{ maxWidth: '100%', width: '100%' }}>
      <h2>Staff</h2>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }, gap: 2, mb: 2 }}>
        <Box>
          <label htmlFor="staff-name">Staff Name</label>
          <input
            id="staff-name"
            className="input"
            placeholder="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Box>
        <Box>
          <label htmlFor="staff-salary">Salary</label>
          <input
            id="staff-salary"
            className="input"
            placeholder="salary"
            type="text"
            value={salary}
            onChange={(e) => {
              const val = e.target.value;
              const num = val === '' ? 0 : Number(val);
              setSalary(isNaN(num) ? salary : num);
            }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="btn btn-primary" onClick={create}>
            Add Staff
          </button>
        </Box>
      </Box>
      <ResponsiveDataGrid
        rows={rows}
        columns={columns}
        cardTitle={(row: any) => row.name}
        cardFields={[
          { label: 'Salary', value: (row: any) => row.salary ?? '-' },
          { label: 'Status', value: (row: any) => row.status ?? '-' },
        ]}
        cardActions={(row: any) => (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="button" onClick={(e) => { e.stopPropagation(); toggleStatus(row) }}>
              Toggle
            </button>
            <button className="btn btn-danger" type="button" onClick={(e) => { e.stopPropagation(); remove(row) }}>
              Delete
            </button>
          </div>
        )}
        onRowOpen={(row: any) => openEditStaff(row)}
      />

      {/* Edit Staff Modal */}
      {editingStaff && (
        <Modal open={true} onClose={() => setEditingStaff(null)}>
          <h2 style={{ margin: '0 0 16px 0' }}>✏️ Edit Staff</h2>
          <Box sx={{ display: 'grid', gap: 2 }}>
            <Box>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Name</label>
              <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </Box>
            <Box>
              <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>Salary</label>
              <input
                className="input"
                type="text"
                value={editSalary}
                onChange={(e) => {
                  const val = e.target.value
                  const num = val === '' ? 0 : Number(val)
                  setEditSalary(isNaN(num) ? editSalary : num)
                }}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <button type="button" className="btn" onClick={() => setEditingStaff(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={saveEditStaff}>✓ Save</button>
            </Box>
          </Box>
        </Modal>
      )}
      
      {/* Totals Summary */}
      <div style={{ 
        marginTop: '20px', 
        padding: '16px', 
        backgroundColor: '#f8f9fa', 
        borderRadius: '8px',
        border: '1px solid #e9ecef'
      }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: 'bold' }}>Summary</h3>
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 'bold', color: '#495057' }}>Total Staff:</span>
            <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#007bff' }}>{totalCount}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 'bold', color: '#495057' }}>Total Salary:</span>
            <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#28a745' }}>
              {totalSalary.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
