import React, { useState } from 'react'
// ── MIGRATED to Neon compat layer ──
// Was: import { db } from '../utils/firebaseClient'
//      import { collection, addDoc, onSnapshot, updateDoc, doc, deleteDoc } from 'firebase/firestore'
import { createDoc, updateDocById, deleteDocById } from '../utils/dataClient'
import { useLiveCollection } from '../hooks/useLiveCollection'
import type { GridColDef } from '@mui/x-data-grid'
import ResponsiveDataGrid from '../components/ResponsiveDataGrid'
import Modal from '../components/Modal'

export default function Assets(){
  const { docs: assets, refresh } = useLiveCollection('assets')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState<number>(0)
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [deprRate, setDeprRate] = useState<number>(10)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [assetToDelete, setAssetToDelete] = useState<any>(null)

  const rows = assets.filter((a) => !!a?.id)

  const columns = [
    { field: 'name', headerName: 'Name', flex: 1, minWidth: 180, editable: true },
    { field: 'purchase_amount', headerName: 'Purchase', width: 120, editable: true, type: 'number', valueGetter: (_v: any, row: any) => row.purchase_amount ?? 0 },
    { field: 'purchase_year', headerName: 'Year', width: 110, editable: true, type: 'number', valueGetter: (_v: any, row: any) => row.purchase_year ?? new Date().getFullYear() },
    {
      field: 'depreciation_rate',
      headerName: 'Depreciation %',
      width: 140,
      editable: true,
      type: 'number',
      valueGetter: (_v: any, row: any) => row.depreciation_rate ?? 0,
      valueFormatter: (value: any) => `${value}%`,
    },
    {
      field: 'appliesTo',
      headerName: 'Applies To',
      flex: 1,
      minWidth: 180,
      valueGetter: (_v: any, row: any) => JSON.stringify(row.appliesTo || []),
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 200,
      sortable: false,
      filterable: false,
      renderCell: (params: any) => (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" type="button" onClick={() => toggleApplyAll(params.row)}>
            Toggle all
          </button>
          <button className="btn btn-danger" type="button" onClick={() => remove(params.row)}>
            Delete
          </button>
        </div>
      ),
    },
  ] as GridColDef<any>[]

  async function create(e?: React.FormEvent){
    if(e) e.preventDefault()
    if(!name) return
    await createDoc('assets', { name, purchase_amount: Number(amount), purchase_year: Number(year), depreciation_rate: Number(deprRate), appliesTo: ['all'] })
    setName(''); setAmount(0); setYear(new Date().getFullYear()); setDeprRate(10)
    refresh()
  }

  async function remove(a:any){
    if(!a.id) return
    setAssetToDelete(a)
    setDeleteModalOpen(true)
  }

  async function confirmDelete(){
    if(!assetToDelete?.id) return
    await deleteDocById('assets', assetToDelete.id)
    setDeleteModalOpen(false)
    setAssetToDelete(null)
    refresh()
  }

  async function toggleApplyAll(a:any){
    if(!a.id) return
    const newApplies = (a.appliesTo && a.appliesTo.includes('all')) ? [] : ['all']
    await updateDocById('assets', a.id, { appliesTo: newApplies })
    refresh()
  }

  async function processRowUpdate(newRow: any, oldRow: any) {
    if (!newRow.id) return oldRow

    try {
      await updateDocById('assets', newRow.id, {
        name: newRow.name,
        purchase_amount: Number(newRow.purchase_amount),
        purchase_year: Number(newRow.purchase_year),
        depreciation_rate: Number(newRow.depreciation_rate),
      })
      refresh()
      return newRow
    } catch (error) {
      console.error('Error updating asset:', error)
      throw error
    }
  }

  function handleProcessRowUpdateError(error: any) {
    console.error('Failed to update asset:', error)
  }

  return (
    <div className="grid">
      <div className="card">
        <h2>Assets (machines)</h2>
        <form onSubmit={create} className="row" style={{ display: 'flex', flexDirection: 'row', gap: '16px', alignItems: 'center' }}>
          <div>
            <label htmlFor="asset-name">Asset Name</label>
            <input
              id="asset-name"
              className="input"
              placeholder="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="purchase-amount">Purchase Amount</label>
            <input
              id="purchase-amount"
              className="input"
              placeholder="purchase amount"
              type="text"
              value={amount}
              onChange={(e) => {
                const val = e.target.value;
                const num = val === '' ? 0 : Number(val);
                setAmount(isNaN(num) ? amount : num);
              }}
            />
          </div>
          <div>
            <label htmlFor="purchase-year">Purchase Year</label>
            <input
              id="purchase-year"
              className="input"
              placeholder="year"
              type="text"
              value={year}
              onChange={(e) => {
                const val = e.target.value;
                const num = val === '' ? new Date().getFullYear() : Number(val);
                setYear(isNaN(num) ? year : num);
              }}
            />
          </div>
          <div>
            <label htmlFor="depreciation-rate">Depreciation Rate (%/yr)</label>
            <input
              id="depreciation-rate"
              className="input"
              placeholder="depreciation %/yr"
              type="text"
              value={deprRate}
              onChange={(e) => {
                const val = e.target.value;
                const num = val === '' ? 0 : Number(val);
                setDeprRate(isNaN(num) ? deprRate : num);
              }}
            />
          </div>
          <button type="submit" className="btn btn-primary">Add asset</button>
        </form>
      </div>
      <div className="card">
        <ResponsiveDataGrid
          rows={rows}
          columns={columns}
          cardTitle={(row: any) => row.name}
          cardFields={[
            { label: 'Purchase', value: (row: any) => row.purchase_amount ?? '-' },
            { label: 'Year', value: (row: any) => row.purchase_year ?? '-' },
            { label: 'Depreciation %', value: (row: any) => (row.depreciation_rate ?? '-') + '%' },
            { label: 'Applies To', value: (row: any) => JSON.stringify(row.appliesTo || []) },
          ]}
          cardActions={(row: any) => (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" type="button" onClick={() => toggleApplyAll(row)}>
                Toggle all
              </button>
              <button className="btn btn-danger" type="button" onClick={() => remove(row)}>
                Delete
              </button>
            </div>
          )}
          processRowUpdate={processRowUpdate}
          onProcessRowUpdateError={handleProcessRowUpdateError}
        />
      </div>

      <Modal
        open={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false)
          setAssetToDelete(null)
        }}
        title="Delete Asset"
      >
        <div style={{ padding: '16px 0' }}>
          <p style={{ margin: '0 0 16px 0' }}>
            Are you sure you want to delete the asset <strong>"{assetToDelete?.name}"</strong>?
          </p>
          <p style={{ margin: '0 0 24px 0', color: '#666', fontSize: '14px' }}>
            This action cannot be undone. The asset will be permanently removed from the system.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <button
              className="btn"
              onClick={() => {
                setDeleteModalOpen(false)
                setAssetToDelete(null)
              }}
            >
              Cancel
            </button>
            <button
              className="btn btn-danger"
              onClick={confirmDelete}
            >
              Delete Asset
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
