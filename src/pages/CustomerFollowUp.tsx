import React, { useEffect, useMemo, useState } from 'react'
// ── MIGRATED to Neon compat layer ──
import { listDocs, createDoc } from '../utils/dataClient'
import { toJsDate } from '../utils/dates'
import type { GridColDef } from '@mui/x-data-grid'
import ResponsiveDataGrid from '../components/ResponsiveDataGrid'
import { toLabelsText } from '../utils/customerSegments'

type Customer = {
  id: string
  name: string
  telephone1?: string
  telephone2?: string
  telephone?: string
  phone?: string
  city?: string
  categoryCodes?: string[]
  allergyCodes?: string[]
}

type Order = {
  id: string
  customerId: string
  createdAt: any
  valueDate?: string
  items: Array<{ productId: string; qtyPackages?: number; qty?: number }>
  subtotal?: number
}

type Product = {
  id: string
  name: string
  price?: number
  unitCost?: number
}

type FollowUp = {
  id: string
  customerId: string
  followedUpAt: Date | null
}

type CustomerMetrics = {
  lastPurchaseDate: Date | null
  totalSpent: number
  orderCount: number
  topProducts: Array<{ name: string; count: number }>
  needsFollowUp: boolean
  lastFollowUpDate: Date | null
  daysSincePurchase: number
}

function fmtCurrency(n: number) {
  if (isNaN(n)) return '-'
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: Date | null) {
  if (!d) return '-'
  return d.toISOString().split('T')[0]
}

export default function CustomerFollowUp() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [productsById, setProductsById] = useState<Record<string, Product>>({})
  const [followUps, setFollowUps] = useState<FollowUp[]>([])
  const [categoryRows, setCategoryRows] = useState<any[]>([])
  const [allergyRows, setAllergyRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [daysThreshold, setDaysThreshold] = useState(30)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [customersArr, ordersArr, productsRows, followUpsRows, categoriesArr, allergiesArr] = await Promise.all([
          listDocs('customers'),
          listDocs('orders'),
          listDocs('products'),
          listDocs('customer_followups'),
          listDocs('customerCategories'),
          listDocs('customerAllergies'),
        ])

        const productsMap: Record<string, Product> = {}
        productsRows.forEach((d) => {
          productsMap[d.id] = d as unknown as Product
        })

        const followUpsArr: FollowUp[] = followUpsRows.map((d: any) => ({
          id: d.id,
          customerId: d.customerId,
          followedUpAt: toJsDate(d.followedUpAt),
        }))

        setCustomers(customersArr as unknown as Customer[])
        setOrders(ordersArr as unknown as Order[])
        setProductsById(productsMap)
        setFollowUps(followUpsArr)
        setCategoryRows(categoriesArr)
        setAllergyRows(allergiesArr)
      } catch (error) {
        console.error('CustomerFollowUp: load error', error)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const categoryLabelMap = useMemo(
    () => Object.fromEntries(categoryRows.map((r) => [String(r.code), String(r.label || r.code)])),
    [categoryRows],
  )

  const allergyLabelMap = useMemo(
    () => Object.fromEntries(allergyRows.map((r) => [String(r.code), String(r.label || r.code)])),
    [allergyRows],
  )

  const customerMetrics = useMemo(() => {
    const metrics: Record<string, CustomerMetrics> = {}
    const now = new Date()
    const thresholdDate = new Date(now.getTime() - daysThreshold * 24 * 60 * 60 * 1000)

    const followUpsByCustomer: Record<string, Date[]> = {}
    for (const f of followUps) {
      if (!f.customerId || !f.followedUpAt) continue
      if (!followUpsByCustomer[f.customerId]) followUpsByCustomer[f.customerId] = []
      followUpsByCustomer[f.customerId].push(f.followedUpAt)
    }

    for (const customer of customers) {
      const customerOrders = orders.filter((o) => o.customerId === customer.id)
      if (!customerOrders.length) continue

      const orderDates = customerOrders
        .map((o) => toJsDate(o.createdAt) || toJsDate(o.valueDate))
        .filter(Boolean) as Date[]

      if (!orderDates.length) continue

      const lastPurchaseDate = new Date(Math.max(...orderDates.map((d) => d.getTime())))
      const daysSincePurchase = Math.max(0, Math.floor((now.getTime() - lastPurchaseDate.getTime()) / (24 * 60 * 60 * 1000)))

      const customerFollowUps = followUpsByCustomer[customer.id] || []
      const lastFollowUpDate = customerFollowUps.length ? new Date(Math.max(...customerFollowUps.map((d) => d.getTime()))) : null

      const needsFollowUp =
        lastPurchaseDate <= thresholdDate &&
        (!lastFollowUpDate || lastFollowUpDate < lastPurchaseDate)

      if (!needsFollowUp) continue

      const totalSpent = customerOrders.reduce((sum, o) => {
        let orderSubtotal = Number(o.subtotal || 0)
        if (!orderSubtotal && o.items) {
          orderSubtotal = o.items.reduce((itemSum, item) => {
            const pid = String(item.productId || '')
            const product = pid ? productsById[pid] : null
            const unit = product ? Number(product.price ?? product.unitCost ?? 0) : 0
            const qty = Number(item.qtyPackages ?? item.qty ?? 0)
            return itemSum + unit * qty
          }, 0)
        }
        return sum + orderSubtotal
      }, 0)

      const productCounts: Record<string, number> = {}
      customerOrders.forEach((o) => {
        ;(o.items || []).forEach((item) => {
          const pid = String(item.productId || '')
          if (!pid) return
          productCounts[pid] = (productCounts[pid] || 0) + Number(item.qtyPackages ?? item.qty ?? 0)
        })
      })

      const topProducts = Object.entries(productCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([pid, count]) => ({ name: productsById[pid]?.name || pid, count }))

      metrics[customer.id] = {
        lastPurchaseDate,
        totalSpent,
        orderCount: customerOrders.length,
        topProducts,
        needsFollowUp,
        lastFollowUpDate,
        daysSincePurchase,
      }
    }

    return metrics
  }, [customers, orders, productsById, followUps, daysThreshold])

  const visibleCustomers = useMemo(() => {
    const base = customers.filter((customer) => customerMetrics[customer.id])
    const q = searchTerm.trim().toLowerCase()

    const filtered = !q
      ? base
      : base.filter((customer) => {
          const name = String(customer.name || '').toLowerCase()
          const city = String(customer.city || '').toLowerCase()
          const phone1 = String(customer.telephone1 || customer.telephone || customer.phone || '').toLowerCase()
          const phone2 = String(customer.telephone2 || '').toLowerCase()
          return name.includes(q) || city.includes(q) || phone1.includes(q) || phone2.includes(q)
        })

    return filtered.sort((a, b) => {
      const aDays = customerMetrics[a.id]?.daysSincePurchase || 0
      const bDays = customerMetrics[b.id]?.daysSincePurchase || 0
      return bDays - aDays
    })
  }, [customers, customerMetrics, searchTerm])

  const rows = useMemo(
    () =>
      visibleCustomers.map((customer) => {
        const metrics = customerMetrics[customer.id]
        return {
          id: customer.id,
          customerName: customer.name || '-',
          phone: [customer.telephone1 || customer.telephone || customer.phone, customer.telephone2].filter(Boolean).join(' / ') || '-',
          city: customer.city || '-',
          categories: toLabelsText(customer.categoryCodes, categoryLabelMap),
          allergies: toLabelsText(customer.allergyCodes, allergyLabelMap),
          lastPurchaseDate: fmtDate(metrics?.lastPurchaseDate || null),
          daysSincePurchase: metrics?.daysSincePurchase || 0,
          orderCount: metrics?.orderCount || 0,
          totalSpent: metrics?.totalSpent || 0,
          topProducts: (metrics?.topProducts || []).map((p) => `${p.name} (${p.count})`).join(', ') || '-',
          lastFollowUpDate: fmtDate(metrics?.lastFollowUpDate || null),
          status: metrics?.needsFollowUp ? 'Pending Follow-Up' : 'Up to Date',
        }
      }),
    [visibleCustomers, customerMetrics, categoryLabelMap, allergyLabelMap],
  )

  const totalPending = rows.length
  const totalRevenueAtRisk = rows.reduce((sum, r) => sum + Number(r.totalSpent || 0), 0)
  const averageDaysSincePurchase = rows.length
    ? Math.round(rows.reduce((sum, r) => sum + Number(r.daysSincePurchase || 0), 0) / rows.length)
    : 0

  async function markFollowedUp(customerId: string) {
    try {
      await createDoc('customer_followups', {
        customerId,
        followedUpAt: new Date().toISOString(),
      })

      setFollowUps((prev) => [
        {
          id: `temp-${Date.now()}`,
          customerId,
          followedUpAt: new Date(),
        },
        ...prev,
      ])
    } catch (error) {
      console.error('CustomerFollowUp: markFollowedUp error', error)
      alert('Failed to save follow-up')
    }
  }

  const columns = [
    { field: 'customerName', headerName: 'Customer', flex: 1, minWidth: 190 },
    { field: 'phone', headerName: 'Phone', flex: 1, minWidth: 170 },
    { field: 'city', headerName: 'City', width: 130 },
    { field: 'categories', headerName: 'Categories', flex: 1, minWidth: 190 },
    { field: 'allergies', headerName: 'Allergies', flex: 1, minWidth: 190 },
    { field: 'lastPurchaseDate', headerName: 'Last Purchase', width: 130 },
    { field: 'daysSincePurchase', headerName: 'Days Since', width: 110 },
    { field: 'orderCount', headerName: 'Orders', width: 90 },
    {
      field: 'totalSpent',
      headerName: 'Total Spent',
      width: 130,
      valueGetter: (_v: any, row: any) => fmtCurrency(Number(row.totalSpent || 0)),
    },
    { field: 'topProducts', headerName: 'Top Products', flex: 1, minWidth: 220 },
    { field: 'lastFollowUpDate', headerName: 'Last Follow-Up', width: 130 },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 140,
      sortable: false,
      filterable: false,
      renderCell: (params: any) => (
        <button
          className="btn btn-primary"
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            markFollowedUp(params.row.id)
          }}
          style={{ padding: '6px 10px' }}
        >
          Mark Done
        </button>
      ),
    },
  ] as GridColDef<any>[]

  if (loading) {
    return (
      <div className="card">
        <div style={{ padding: 24 }}>Loading customer follow-up...</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ marginBottom: 0 }}>Customer Follow-Up</h2>
          <div style={{ color: 'var(--text-light)', fontSize: 13 }}>Track customers who need re-engagement</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input"
            type="text"
            placeholder="Search by customer, phone, or city"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ flex: '1 1 320px', minWidth: 220 }}
          />
          <input
            className="input"
            type="text"
            value={daysThreshold}
            onChange={(e) => {
              const num = Number(e.target.value)
              setDaysThreshold(isNaN(num) ? daysThreshold : num)
            }}
            style={{ width: 120 }}
            placeholder="Threshold"
          />
          <div style={{ fontSize: 13, color: 'var(--text-light)' }}>days threshold</div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="card" style={{ padding: 12, marginBottom: 0 }}>
          <div style={{ color: 'var(--text-light)', fontSize: 12 }}>Pending Follow-Ups</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{totalPending}</div>
        </div>
        <div className="card" style={{ padding: 12, marginBottom: 0 }}>
          <div style={{ color: 'var(--text-light)', fontSize: 12 }}>Revenue Exposure</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{fmtCurrency(totalRevenueAtRisk)}</div>
        </div>
        <div className="card" style={{ padding: 12, marginBottom: 0 }}>
          <div style={{ color: 'var(--text-light)', fontSize: 12 }}>Avg. Days Since Last Purchase</div>
          <div style={{ fontWeight: 700, fontSize: 22 }}>{averageDaysSincePurchase}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <ResponsiveDataGrid
          rows={rows}
          columns={columns}
          cardTitle={(row: any) => row.customerName}
          cardFields={[
            { label: 'Phone', value: (row: any) => row.phone },
            { label: 'City', value: (row: any) => row.city },
            { label: 'Categories', value: (row: any) => row.categories },
            { label: 'Allergies', value: (row: any) => row.allergies },
            { label: 'Last Purchase', value: (row: any) => row.lastPurchaseDate },
            { label: 'Days Since', value: (row: any) => row.daysSincePurchase },
            { label: 'Orders', value: (row: any) => row.orderCount },
            { label: 'Total Spent', value: (row: any) => fmtCurrency(Number(row.totalSpent || 0)) },
            { label: 'Top Products', value: (row: any) => row.topProducts },
            { label: 'Last Follow-Up', value: (row: any) => row.lastFollowUpDate },
          ]}
          cardActions={(row: any) => (
            <button
              className="btn btn-primary"
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                markFollowedUp(row.id)
              }}
            >
              Mark Done
            </button>
          )}
        />
      </div>
    </div>
  )
}
