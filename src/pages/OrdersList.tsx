import React, { useEffect, useMemo, useState } from 'react'
import { getDocById, callApi, ApiError } from '../utils/dataClient'
import { useLiveCollection } from '../hooks/useLiveCollection'
import { toJsDate } from '../utils/dates'
import { Link, useNavigate } from 'react-router-dom'
import type { GridColDef } from '@mui/x-data-grid'
import ResponsiveDataGrid from '../components/ResponsiveDataGrid'
import {
  useTheme,
  useMediaQuery,
  Box,
  Tabs,
  Tab,
  TextField,
  Fab,
  Chip,
  Button,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { useSnackbar } from '../hooks/useSnackbar'
import { useConfirmDialog } from '../hooks/useConfirmDialog'
import { useRole } from '../utils/RoleContext'

function toDate(val: any): Date | null {
  return toJsDate(val)
}

function withinRange(d: Date | null, start: Date, end: Date) {
  if (!d) return false
  return d >= start && d <= end
}

function StatusChip({ row }: { row: any }) {
  const label = row.delivered
    ? 'Delivered'
    : row.paid
      ? 'Paid'
      : Number(row.amountPaid || 0) > 0
        ? 'Part-paid'
        : 'Booked'
  const color: any = row.delivered ? 'success' : row.paid ? 'primary' : Number(row.amountPaid || 0) > 0 ? 'warning' : 'default'
  return <Chip label={label} color={color} size="small" />
}

export default function OrdersList() {
  const DELETE_PASSCODE = '2018'
  // onSnapshot(orders, orderBy createdAt desc) + onSnapshot(products) → polling hooks.
  const { docs: rawOrders, refresh } = useLiveCollection('orders', { orderBy: { field: 'createdAt', dir: 'desc' } })
  const { docs: productDocs } = useLiveCollection('products')
  const [orders, setOrders] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'booked' | 'paid' | 'delivered'>('booked')
  const navigate = useNavigate()
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const { showSuccess, showError, SnackbarElement } = useSnackbar()
  const { confirm, ConfirmElement } = useConfirmDialog()
  const role = useRole()
  const canDelete = role === 'admin'

  // Date range filters for each tab
  const [bookedStartDate, setBookedStartDate] = useState('')
  const [bookedEndDate, setBookedEndDate] = useState('')
  const [paidStartDate, setPaidStartDate] = useState('')
  const [paidEndDate, setPaidEndDate] = useState('')
  const [deliveredStartDate, setDeliveredStartDate] = useState('')
  const [deliveredEndDate, setDeliveredEndDate] = useState('')

  const productsById = useMemo(() => {
    const map: Record<string, any> = {}
    productDocs.forEach((d) => (map[d.id] = d))
    return map
  }, [productDocs])

  useEffect(() => {
    if (rawOrders.length === 0) {
      setOrders([])
      return
    }
    ;(async () => {
      const enriched = await Promise.all(
        rawOrders.map(async (o: any) => {
          let custName = o.customerId
          let custTel = ''
          let custLocation = ''
          try {
            const cd = await getDocById('customers', o.customerId)
            if (cd) {
              custName = cd.name || custName
              custTel = [cd.telephone1, cd.telephone2, cd.telephone, cd.phone].filter(Boolean).join(' / ')
              custLocation = [cd.deliveryAddress1, cd.city].filter(Boolean).join(', ')
            }
          } catch (e) {}

          const subtotal = (o.items || []).reduce((s: number, it: any) => {
            const pid = String(it.productId || '')
            const p = pid ? productsById[pid] : null
            const unit = p ? Number(p.price ?? p.unitCost ?? 0) : 0
            const qty = Number(it.qtyPackages ?? it.qty ?? 0)
            return s + unit * qty
          }, 0)

          return { ...o, customerName: custName, customerTel: custTel, customerLocation: custLocation, subtotal }
        }),
      )
      setOrders(enriched)
    })()
  }, [rawOrders, productsById])

  const filtered = orders
    .filter((o) => {
      if (!search) return true
      const q = search.toLowerCase()
      return (
        String(o.id || '').toLowerCase().includes(q) ||
        String(o.customerName || '').toLowerCase().includes(q) ||
        String(o.customerTel || '').toLowerCase().includes(q)
      )
    })
    .filter((o) => {
      const isDelivered = !!o.delivered
      const isPaid = !!o.paid
      if (tab === 'booked') return !isPaid && !isDelivered
      if (tab === 'paid') return isPaid && !isDelivered
      return isDelivered
    })
    .filter((o) => {
      if (tab === 'booked') {
        if (!bookedStartDate && !bookedEndDate) return true
        const orderDate = toDate(o.createdAt)
        if (!orderDate) return false
        const start = bookedStartDate ? new Date(bookedStartDate) : new Date('1900-01-01')
        const end = bookedEndDate ? new Date(bookedEndDate) : new Date('2100-01-01')
        end.setHours(23, 59, 59, 999)
        return withinRange(orderDate, start, end)
      } else if (tab === 'paid' || tab === 'delivered') {
        const startField = tab === 'paid' ? paidStartDate : deliveredStartDate
        const endField = tab === 'paid' ? paidEndDate : deliveredEndDate
        if (!startField && !endField) return true
        const paymentDate = toDate(o.valueDate)
        if (!paymentDate) return false
        const start = startField ? new Date(startField) : new Date('1900-01-01')
        const end = endField ? new Date(endField) : new Date('2100-01-01')
        end.setHours(23, 59, 59, 999)
        return withinRange(paymentDate, start, end)
      }
      return true
    })

  async function removeOrder(order: any, e?: React.MouseEvent) {
    e?.stopPropagation()

    const code = await confirm(
      'Enter authorization passcode to delete this transaction:',
      'Delete Order',
      'Passcode',
    )
    if (!code) return
    if (String(code) !== DELETE_PASSCODE) {
      showError('Incorrect passcode. Transaction was not deleted.')
      return
    }
    const confirmed = await confirm(`Delete transaction ${order.id}? This action cannot be undone.`, 'Confirm Delete')
    if (!confirmed) return

    try {
      // Worker deletes the order atomically (payments + revenue + audit + cascade).
      await callApi(`/api/orders/${order.id}/delete`, { body: { passcode: code } })
      showSuccess('Order deleted.')
      refresh()
    } catch (err: any) {
      if (err instanceof ApiError && err.body?.error === 'invalid_passcode') {
        showError('Incorrect passcode. Transaction was not deleted.')
        return
      }
      console.error('OrdersList:removeOrder failed', { orderId: order?.id, err })
      showError(err?.message || 'Failed to delete transaction')
    }
  }

  const tabIndex = tab === 'booked' ? 0 : tab === 'paid' ? 1 : 2

  const DateFilter = ({
    label,
    start, setStart,
    end, setEnd,
  }: {
    label: string
    start: string; setStart: (v: string) => void
    end: string; setEnd: (v: string) => void
  }) => (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', mb: 1.5 }}>
      <Box component="span" sx={{ fontWeight: 500, whiteSpace: 'nowrap', fontSize: 14 }}>{label}:</Box>
      <TextField
        type="date"
        size="small"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        sx={{ width: { xs: '100%', sm: 150 } }}
        InputLabelProps={{ shrink: true }}
        label="From"
      />
      <TextField
        type="date"
        size="small"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        sx={{ width: { xs: '100%', sm: 150 } }}
        InputLabelProps={{ shrink: true }}
        label="To"
      />
      {(start || end) && (
        <Button size="small" onClick={() => { setStart(''); setEnd('') }}>Clear</Button>
      )}
    </Box>
  )

  return (
    <Box sx={{ p: { xs: 1.5, md: 2 } }}>
      {SnackbarElement}
      {ConfirmElement}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
        <Box component="h2" sx={{ m: 0, fontSize: { xs: 20, md: 24 } }}>Orders</Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/orders/new')}>
          New Order
        </Button>
      </Box>

      {/* Status tabs */}
      <Tabs
        value={tabIndex}
        onChange={(_e, v) => setTab(v === 0 ? 'booked' : v === 1 ? 'paid' : 'delivered')}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Booked" />
        <Tab label="Paid" />
        <Tab label="Delivered" />
      </Tabs>

      {/* Date filters */}
      {tab === 'booked' && (
        <DateFilter
          label="Order Date"
          start={bookedStartDate} setStart={setBookedStartDate}
          end={bookedEndDate} setEnd={setBookedEndDate}
        />
      )}
      {tab === 'paid' && (
        <DateFilter
          label="Payment Date"
          start={paidStartDate} setStart={setPaidStartDate}
          end={paidEndDate} setEnd={setPaidEndDate}
        />
      )}
      {tab === 'delivered' && (
        <DateFilter
          label="Payment Date"
          start={deliveredStartDate} setStart={setDeliveredStartDate}
          end={deliveredEndDate} setEnd={setDeliveredEndDate}
        />
      )}

      {/* Search */}
      <Box sx={{ mb: 1.5 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Search by customer name or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Box>

      <ResponsiveDataGrid
        rows={filtered}
        columns={([
          {
            field: 'id',
            headerName: 'Order',
            width: 220,
            renderCell: (params) => <Link to={`/orders/${params.row.id}`}>{String(params.row.id)}</Link>,
          },
          {
            field: 'subtotal',
            headerName: 'Amount',
            width: 130,
            valueFormatter: (value) => Number(value ?? 0).toFixed(2),
          },
          { field: 'customerName', headerName: 'Customer', flex: 1, minWidth: 180 },
          { field: 'customerTel', headerName: 'Phone', flex: 1, minWidth: 160 },
          {
            field: 'customerLocation',
            headerName: 'Location',
            flex: 1,
            minWidth: 200,
            valueGetter: (_value, row: any) => row.customerLocation || '-',
          },
          {
            field: 'bookingDate',
            headerName: 'Booking Date',
            width: 130,
            valueGetter: (_value, row: any) => {
              const date = toDate(row.createdAt)
              return date ? date.toISOString().split('T')[0] : '-'
            },
          },
          {
            field: 'paidDate',
            headerName: 'Paid Date',
            width: 130,
            valueGetter: (_value, row: any) => {
              const date = toDate(row.valueDate)
              return date ? date.toISOString().split('T')[0] : '-'
            },
          },
          {
            field: 'statusLabel',
            headerName: 'Status',
            width: 130,
            renderCell: (params) => <StatusChip row={params.row} />,
            valueGetter: (_value, row: any) =>
              row.delivered ? 'Delivered' : row.paid ? 'Paid' : Number(row.amountPaid || 0) > 0 ? 'Part-paid' : 'Booked',
          },
          {
            field: 'actions',
            headerName: 'Actions',
            width: 120,
            sortable: false,
            filterable: false,
            disableColumnMenu: true,
            renderCell: (params) => canDelete ? (
              <button type="button" className="btn btn-danger" onClick={(e) => removeOrder(params.row, e)} style={{ padding: '4px 10px' }}>
                Delete
              </button>
            ) : null,
          },
          ...(tab === 'delivered'
            ? [
                {
                  field: 'deliveredBy',
                  headerName: 'Rider',
                  width: 140,
                  valueGetter: (_value: any, row: any) => row.deliveredBy || '',
                },
              ]
            : []),
        ] as GridColDef<any>[])}
        cardTitle={(row: any) => row.customerName || `Order ${row.id.slice(0, 8)}`}
        cardFields={[
          { label: 'Order ID', value: (row: any) => row.id.slice(0, 16) + '...' },
          { label: 'Amount', value: (row: any) => Number(row.subtotal || 0).toFixed(2) },
          { label: 'Phone', value: (row: any) => row.customerTel || '-' },
          { label: 'Location', value: (row: any) => row.customerLocation || '-' },
          {
            label: 'Booking Date',
            value: (row: any) => {
              const date = toDate(row.createdAt)
              return date ? date.toISOString().split('T')[0] : '-'
            },
          },
          {
            label: 'Paid Date',
            value: (row: any) => {
              const date = toDate(row.valueDate)
              return date ? date.toISOString().split('T')[0] : '-'
            },
          },
          {
            label: 'Status',
            value: (row: any) =>
              row.delivered ? 'Delivered' : row.paid ? 'Paid' : Number(row.amountPaid || 0) > 0 ? 'Part-paid' : 'Booked',
          },
          ...(tab === 'delivered' ? [{ label: 'Rider', value: (row: any) => row.deliveredBy || '-' }] : []),
        ]}
        cardActions={(row: any) => (
          <Box sx={{ display: 'flex', gap: 1 }} onClick={(e) => e.stopPropagation()}>
            <Button variant="contained" size="small" onClick={() => navigate(`/orders/${row.id}`)}>
              View
            </Button>
            {canDelete && (
              <button type="button" className="btn btn-danger" onClick={(e) => removeOrder(row, e)}>
                Delete
              </button>
            )}
          </Box>
        )}
        onRowOpen={(row: any) => navigate(`/orders/${row.id}`)}
      />

    </Box>
  )
}
