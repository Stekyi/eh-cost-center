import React, { useEffect, useMemo, useState } from 'react'
import { listDocs } from '../utils/dataClient'
import * as XLSX from 'xlsx'
import type { GridColDef } from '@mui/x-data-grid'
import { useTheme, useMediaQuery } from '@mui/material'
import ResponsiveDataGrid from '../components/ResponsiveDataGrid'
import LocationBubbles from '../components/LocationBubbles'
import Modal from '../components/Modal'

/* ── Utility helpers ─────────────────────────────────────────────── */

type TrendGranularity = 'daily' | 'weekly' | 'monthly' | 'yearly'

const TREND_GRANULARITY_OPTIONS: { value: TrendGranularity; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

const WEEKDAY_BUCKETS = [
  { key: 'Monday', label: 'Monday', sort: 1 },
  { key: 'Tuesday', label: 'Tuesday', sort: 2 },
  { key: 'Wednesday', label: 'Wednesday', sort: 3 },
  { key: 'Thursday', label: 'Thursday', sort: 4 },
  { key: 'Friday', label: 'Friday', sort: 5 },
  { key: 'Saturday', label: 'Saturday', sort: 6 },
  { key: 'Sunday', label: 'Sunday', sort: 7 },
]

const WEEK_OF_MONTH_BUCKETS = [1, 2, 3, 4, 5].map((week) => ({
  key: `Week ${week}`,
  label: `Week ${week}`,
  sort: week,
}))

function startOfDay(d: Date) {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function yearKey(d: Date) {
  return String(d.getFullYear())
}

function getWeekOfMonth(d: Date) {
  return Math.min(5, Math.floor((d.getDate() - 1) / 7) + 1)
}

function getWeekdayIndex(d: Date) {
  return (d.getDay() + 6) % 7
}

function getPeriodBucket(d: Date, granularity: TrendGranularity) {
  if (granularity === 'daily') return WEEKDAY_BUCKETS[getWeekdayIndex(d)]
  if (granularity === 'weekly') return WEEK_OF_MONTH_BUCKETS[getWeekOfMonth(d) - 1]
  if (granularity === 'monthly') {
    const key = monthKey(d)
    return { key, label: key, sort: new Date(d.getFullYear(), d.getMonth(), 1).getTime() }
  }
  const key = yearKey(d)
  return { key, label: key, sort: new Date(d.getFullYear(), 0, 1).getTime() }
}

function buildPeriodBuckets(start: Date, end: Date, granularity: TrendGranularity) {
  if (granularity === 'daily') return WEEKDAY_BUCKETS
  if (granularity === 'weekly') return WEEK_OF_MONTH_BUCKETS
  if (granularity === 'monthly') {
    const buckets: Array<{ key: string; label: string; sort: number }> = []
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
    const last = new Date(end.getFullYear(), end.getMonth(), 1)
    while (cursor <= last) {
      const key = monthKey(cursor)
      buckets.push({ key, label: key, sort: cursor.getTime() })
      cursor.setMonth(cursor.getMonth() + 1)
    }
    return buckets
  }
  const buckets: Array<{ key: string; label: string; sort: number }> = []
  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
    const key = String(year)
    buckets.push({ key, label: key, sort: new Date(year, 0, 1).getTime() })
  }
  return buckets
}

function groupByPeriod(
  items: any[],
  getDate: (x: any) => Date | null,
  getVal: (x: any) => number,
  granularity: TrendGranularity,
  rangeStart: Date,
  rangeEnd: Date,
) {
  const map: Record<string, { period: string; total: number; items: any[]; sort: number }> = {}
  buildPeriodBuckets(rangeStart, rangeEnd, granularity).forEach((bucket) => {
    map[bucket.key] = { period: bucket.label, total: 0, items: [], sort: bucket.sort }
  })
  items.forEach((it) => {
    const d = getDate(it)
    if (!d || !withinRange(d, rangeStart, rangeEnd)) return
    const bucket = getPeriodBucket(d, granularity)
    if (!map[bucket.key]) {
      map[bucket.key] = { period: bucket.label, total: 0, items: [], sort: bucket.sort }
    }
    map[bucket.key].total += getVal(it)
    map[bucket.key].items.push(it)
  })
  return Object.values(map)
    .sort((a, b) => a.sort - b.sort || a.period.localeCompare(b.period))
    .map(({ period, total, items }) => ({ period, total, items }))
}

function dailyDepreciationForDate(date: Date, assets: any[]) {
  const dayStart = startOfDay(date).getTime()
  return assets.reduce((sum, a) => {
    const purchaseYear = Number(a.purchase_year) || new Date().getFullYear()
    const purchaseAmount = Number(a.purchase_amount) || 0
    const rate = Number(a.depreciation_rate) || 0
    const assetStart = new Date(purchaseYear, 0, 1).getTime()
    if (dayStart < assetStart) return sum
    return sum + ((purchaseAmount * (rate / 100)) / 365)
  }, 0)
}

function toDate(val: any): Date | null {
  if (!val) return null
  if (val.toDate) return val.toDate()
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d
}

function fmtCurrency(n: number) {
  if (isNaN(n)) return '-'
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(d: Date | null) {
  if (!d) return '-'
  return d.toISOString().split('T')[0]
}

function addDays(d: Date, days: number) {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + days)
  return copy
}

function toDateKey(val: any): string | null {
  if (!val) return null
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val
  }
  const d = toDate(val)
  if (!d) return null
  return fmtDate(d)
}

function withinRange(d: Date | null, start: Date, end: Date) {
  if (!d) return false
  return d >= start && d <= end
}

function exportExcel(filename: string, rows: Record<string, any>[]) {
  if (!rows.length) return
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Report')
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

function clampDateKey(key: string) {
  if (!key) return ''
  return key.length >= 10 ? key.slice(0, 10) : key
}

function inDateKeyRange(key: string | null, startKey: string, endKey: string) {
  if (!key) return false
  const k = clampDateKey(key)
  return k >= startKey && k <= endKey
}

function normalizeKey(val: any) {
  return String(val || '').trim().toLowerCase()
}

/* ── Collapsible section wrapper ─────────────────────────────────── */

function Section({ id, title, children, defaultOpen = true }: { id?: string; title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div id={id} style={{ background: '#fff', borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 20, border: '1px solid #e5e7eb', scrollMarginTop: 12 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{ width: '100%', textAlign: 'left', padding: '16px 20px', background: 'transparent', border: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'background 0.2s' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <span style={{ fontWeight: 700, fontSize: 16, color: '#111827' }}>{title}</span>
        <span style={{ fontSize: 13, color: '#6b7280', fontWeight: 500 }}>{open ? '▼ Hide' : '▶ Show'}</span>
      </button>
      {open && <div style={{ padding: '0 20px 20px' }}>{children}</div>}
    </div>
  )
}

/* ── Section navigation definitions ──────────────────────────────── */

const sectionNav = [
  { id: 'key-metrics', label: '📈 Key Metrics' },
  { id: 'juice-tier', label: '🍹 Juice Tier' },
  { id: 'expenses', label: '💸 Expenses' },
  { id: 'revenue', label: '💰 Revenue' },
  { id: 'riders', label: '🚴 Riders' },
  { id: 'pnl', label: '📊 P&L' },
  { id: 'top-customers', label: '👥 Top Customers' },
  { id: 'customer-categories', label: '🏷️ Categories' },
  { id: 'customer-allergies', label: '🧬 Allergies' },
  { id: 'recent-payments', label: '🧾 Recent Payments' },
  { id: 'location', label: '📍 Location' },
  { id: 'aov', label: '🛒 AOV Trend' },
  { id: 'retention', label: '🔄 Retention' },
]

/* ── Dashboard ───────────────────────────────────────────────────── */

export default function Dashboard() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const today = useMemo(() => new Date(), [])
  const defaultStart = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - 3); return d }, [])

  /* ── State ────────────────────────────────── */
  const [startDate, setStartDate] = useState(fmtDate(defaultStart))
  const [endDate, setEndDate] = useState(fmtDate(today))
  const [includeUnpaid, setIncludeUnpaid] = useState(false)
  const [viewMode, setViewMode] = useState<'revenue' | 'volume'>('revenue')

  const [orders, setOrders] = useState<any[]>([])
  const [productsById, setProductsById] = useState<Record<string, any>>({})
  const [expenses, setExpenses] = useState<any[]>([])
  const [assets, setAssets] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [customerCategories, setCustomerCategories] = useState<any[]>([])
  const [customerAllergies, setCustomerAllergies] = useState<any[]>([])
  const [recentPayments, setRecentPayments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [drilldown, setDrilldown] = useState<{ title: string; rows: any[] } | null>(null)
  const [productSearch, setProductSearch] = useState('')
  const [productTypeFilter, setProductTypeFilter] = useState<'all' | 'juice' | 'meal' | 'shot' | 'package'>('all')
  const [expenseSearch, setExpenseSearch] = useState('')
  const [riderSearch, setRiderSearch] = useState('')
  const [riderReportFields, setRiderReportFields] = useState({ location: true, date: true, rider: false })
  const [customerSearch, setCustomerSearch] = useState('')
  const [lapsedSearch, setLapsedSearch] = useState('')
  const [paymentSearch, setPaymentSearch] = useState('')
  const [repeatSearch, setRepeatSearch] = useState('')
  const [postingStartDate, setPostingStartDate] = useState(() => {
    const d = new Date()
    d.setDate(1)
    return fmtDate(d)
  })
  const [postingEndDate, setPostingEndDate] = useState(fmtDate(today))
  const [postingProductTypes, setPostingProductTypes] = useState<string[]>([])
  const [postingProductIds, setPostingProductIds] = useState<string[]>([])
  const [chartViewMode, setChartViewMode] = useState<'amount' | 'quantity' | 'orders' | 'both' | 'all' | 'none'>('both')
  const [locationMode, setLocationMode] = useState<'customers' | 'orders'>('customers')
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('monthly')
  const [salesTrendMetric, setSalesTrendMetric] = useState<'revenue' | 'units' | 'orders'>('revenue')
  const [tierMonth, setTierMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const TOP_LOCATIONS = 10

  /* ── Data loading ─────────────────────────── */
  useEffect(() => {
    async function load() {
      setLoading(true)
      const [ordersArr, productsArr, expArr, assetsArr, custArr, categoryArr, allergyArr] = await Promise.all([
        listDocs('orders'),
        listDocs('products'),
        listDocs('expenseItems'),
        listDocs('assets'),
        listDocs('customers'),
        listDocs('customerCategories'),
        listDocs('customerAllergies'),
      ])

      const prodMap: Record<string, any> = {}
      productsArr.forEach((d) => (prodMap[d.id] = d))

      setOrders(ordersArr)
      setProductsById(prodMap)
      setExpenses(expArr)
      setAssets(assetsArr)
      setCustomers(custArr)
      setCustomerCategories(categoryArr)
      setCustomerAllergies(allergyArr)
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    async function loadPayments() {
      try {
        const arr = await listDocs('revenue', { orderBy: { field: 'createdAt', dir: 'desc' }, limit: 5 })
        setRecentPayments(arr)
      } catch (e) {
        console.error('Failed to load recent payments', e)
      }
    }
    loadPayments()
  }, [])

  /* ── Unified date range (single filter for entire dashboard) ──── */
  const rangeStart = useMemo(() => new Date(startDate), [startDate])
  const rangeEnd = useMemo(() => { const d = new Date(endDate); d.setHours(23, 59, 59, 999); return d }, [endDate])
  const startKey = useMemo(() => clampDateKey(startDate), [startDate])
  const endKey = useMemo(() => clampDateKey(endDate), [endDate])

  /* ── Orders in range — uses valueDate with fallback to createdAt/date ── */
  const ordersInRange = useMemo(() => {
    return orders
      .filter((o) => includeUnpaid || o.paid)
      .filter((o) => withinRange(toDate(o.valueDate) || toDate(o.createdAt) || toDate(o.date), rangeStart, rangeEnd))
      .map((o) => {
        const subtotal = (o.items || []).reduce((s: number, it: any) => {
          const pid = String(it.productId || '')
          const p = pid ? productsById[pid] : null
          const unit = p ? Number(p.price ?? p.unitCost ?? 0) : 0
          const qty = Number(it.qtyPackages ?? it.qty ?? 0)
          return s + unit * qty
        }, 0)
        return { ...o, subtotal }
      })
  }, [orders, includeUnpaid, rangeStart, rangeEnd, productsById])

  /* ── Paid orders filtered by valueDate (with fallback) ── */
  const paidOrdersInValueRange = useMemo(() => {
    return orders
      .filter((o) => !!o.paid)
      .filter((o) => inDateKeyRange(toDateKey(o.valueDate) || toDateKey(o.createdAt) || toDateKey(o.date), startKey, endKey))
  }, [orders, startKey, endKey])

  const paidRevenueAmount = useMemo(
    () => paidOrdersInValueRange.reduce((sum, o) => sum + Number(o.amountPaid || 0), 0),
    [paidOrdersInValueRange],
  )

  const paidDeliveryFeeAmount = useMemo(
    () => paidOrdersInValueRange.reduce((sum, o) => sum + Number(o.deliveryFee || 0), 0),
    [paidOrdersInValueRange],
  )

  const paidNetRevenueAmount = useMemo(
    () => paidOrdersInValueRange.reduce((sum, o) => sum + (Number(o.amountPaid || 0) - Number(o.deliveryFee || 0)), 0),
    [paidOrdersInValueRange],
  )

  const productsSoldAgg = useMemo(() => {
    const map: Record<string, { productId: string; name: string; type: string; packages: number; units: number; amount: number }> = {}
    for (const o of paidOrdersInValueRange) {
      for (const it of o.items || []) {
        const productId = String(it.productId || '')
        if (!productId) continue
        const p = productsById[productId] || null
        const name = String(p?.name || productId)
        const type = String(p?.type || '')
        const unitCost = Number(p?.price ?? p?.unitCost ?? 0)
        const unitsPerPackage = Number(p?.unitsPerPackage ?? p?.unitsPerPack ?? 1)
        const packages = Number(it.qtyPackages ?? it.qty ?? 0)
        const units = packages * (Number.isFinite(unitsPerPackage) && unitsPerPackage > 0 ? unitsPerPackage : 1)
        if (!map[productId]) {
          map[productId] = { productId, name, type, packages: 0, units: 0, amount: 0 }
        }
        map[productId].packages += packages
        map[productId].units += units
        map[productId].amount += packages * unitCost
      }
    }
    return Object.values(map).sort((a, b) => b.amount - a.amount)
  }, [paidOrdersInValueRange, productsById])

  const filteredProductsSoldAgg = useMemo(() => {
    const q = productSearch.trim().toLowerCase()
    return productsSoldAgg.filter((p) => {
      if (productTypeFilter !== 'all' && normalizeKey(p.type) !== productTypeFilter) return false
      if (q && !p.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [productSearch, productTypeFilter, productsSoldAgg])

  const productOrderCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const o of paidOrdersInValueRange) {
      const seen = new Set<string>()
      for (const it of o.items || []) {
        const productId = String(it.productId || '')
        if (!productId || seen.has(productId)) continue
        seen.add(productId)
        map[productId] = (map[productId] || 0) + 1
      }
    }
    return map
  }, [paidOrdersInValueRange])

  const filteredProductIds = useMemo(() => new Set(filteredProductsSoldAgg.map((p) => p.productId)), [filteredProductsSoldAgg])

  const filteredProductOrderTotal = useMemo(
    () => paidOrdersInValueRange.filter((o) => (o.items || []).some((it: any) => filteredProductIds.has(String(it.productId || '')))).length,
    [filteredProductIds, paidOrdersInValueRange],
  )

  const postingProductTypeOptions = useMemo(() => {
    const types = new Set<string>()
    Object.values(productsById).forEach((p: any) => {
      const t = normalizeKey(p?.type)
      if (t) types.add(t)
    })
    return Array.from(types).sort((a, b) => a.localeCompare(b))
  }, [productsById])

  const postingProductOptions = useMemo(() => {
    const selectedTypes = postingProductTypes.length ? new Set(postingProductTypes.map((x) => normalizeKey(x))) : null
    return Object.entries(productsById)
      .filter(([, p]: [string, any]) => {
        if (!selectedTypes) return true
        return selectedTypes.has(normalizeKey(p?.type))
      })
      .map(([id, p]: [string, any]) => ({ id, name: String(p?.name || id), type: normalizeKey(p?.type) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [productsById, postingProductTypes])

  const postingVisibleProductIdSet = useMemo(() => new Set(postingProductOptions.map((p) => p.id)), [postingProductOptions])

  const postingEffectiveProductIds = useMemo(
    () => postingProductIds.filter((id) => postingVisibleProductIdSet.has(id)),
    [postingProductIds, postingVisibleProductIdSet],
  )

  const postingProductReportRows = useMemo(() => {
    const start = new Date(postingStartDate)
    const end = new Date(postingEndDate)
    end.setHours(23, 59, 59, 999)
    const selectedSet = postingEffectiveProductIds.length ? new Set(postingEffectiveProductIds) : null
    const map: Record<string, { id: string; postingDate: string; productId: string; product: string; count: number; unitCount: number; orders: Set<string> }> = {}

    for (const o of orders) {
      if (!o.paid) continue
      const postingDate = toDate(o.createdAt) || toDate(o.date) || toDate(o.valueDate)
      if (!withinRange(postingDate, start, end)) continue
      const postingDateKey = fmtDate(postingDate)

      for (const it of o.items || []) {
        const productId = String(it.productId || '')
        if (!productId) continue
        if (selectedSet && !selectedSet.has(productId)) continue
        const p = productsById[productId] || null
        const product = String(p?.name || productId)
        const productType = normalizeKey(p?.type)
        const unitsPerPackage = Number(p?.unitsPerPackage ?? p?.unitsPerPack ?? 1)
        const count = Number(it.qtyPackages ?? it.qty ?? 0)
        const unitCount = count * (Number.isFinite(unitsPerPackage) && unitsPerPackage > 0 ? unitsPerPackage : 1)
        const id = `${postingDateKey}__${productId}`

        if (!map[id]) {
          map[id] = { id, postingDate: postingDateKey, productId, product, count: 0, unitCount: 0, orders: new Set<string>() }
        }
        map[id].count += count
        map[id].unitCount += unitCount
        map[id].orders.add(String(o.id || ''))
      }
    }

    return Object.values(map)
      .map((r) => ({
        id: r.id,
        postingDate: r.postingDate,
        productId: r.productId,
        product: r.product,
        productType: normalizeKey(productsById[r.productId]?.type),
        orderCount: r.orders.size,
        count: r.count,
        unitCount: r.unitCount,
      }))
      .sort((a, b) => b.postingDate.localeCompare(a.postingDate) || a.product.localeCompare(b.product))
  }, [orders, postingStartDate, postingEndDate, postingEffectiveProductIds, productsById])

  const postingReportSummary = useMemo(() => {
    return postingProductReportRows.reduce(
      (acc, row) => {
        acc.rows += 1
        acc.orders += Number(row.orderCount || 0)
        acc.count += Number(row.count || 0)
        acc.unitCount += Number(row.unitCount || 0)
        return acc
      },
      { rows: 0, orders: 0, count: 0, unitCount: 0 },
    )
  }, [postingProductReportRows])

  useEffect(() => {
    if (!postingProductIds.length) return
    const next = postingProductIds.filter((id) => postingVisibleProductIdSet.has(id))
    if (next.length !== postingProductIds.length) {
      setPostingProductIds(next)
    }
  }, [postingProductIds, postingVisibleProductIdSet])

  const totalPacksSold = useMemo(
    () => productsSoldAgg.reduce((sum, p) => sum + Number(p.packages || 0), 0),
    [productsSoldAgg],
  )

  const totalUnitsSold = useMemo(
    () => productsSoldAgg.reduce((sum, p) => sum + Number(p.units || 0), 0),
    [productsSoldAgg],
  )

  /* ── Juice Tier Tracker ──────────────────────────── */
  const JUICE_TIERS = [
    { tier: 0, min: 0, max: 1999, bonus: 0, label: 'No bonus', msg: 'Quiet month — keep pushing!' },
    { tier: 1, min: 2000, max: 2499, bonus: 100, label: 'GHS 100', msg: 'Good — small bonus earned!' },
    { tier: 2, min: 2500, max: 2999, bonus: 200, label: 'GHS 200', msg: 'Great — excellent bonus!' },
    { tier: 3, min: 3000, max: Infinity, bonus: 300, label: 'GHS 300', msg: 'Outstanding — max bonus!' },
  ]

  const tierMonthOptions = useMemo(() => {
    const seen = new Set<string>()
    const months: string[] = []
    for (const o of orders) {
      if (!o.paid) continue
      const d = toDate(o.valueDate) || toDate(o.createdAt) || toDate(o.date)
      if (!d) continue
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!seen.has(mk)) { seen.add(mk); months.push(mk) }
    }
    return months.sort().reverse()
  }, [orders])

  const juiceTierData = useMemo(() => {
    const [y, m] = tierMonth.split('-').map(Number)
    let totalBottles = 0
    for (const o of orders) {
      if (!o.paid) continue
      const d = toDate(o.valueDate) || toDate(o.createdAt) || toDate(o.date)
      if (!d || d.getFullYear() !== y || d.getMonth() + 1 !== m) continue
      for (const it of o.items || []) {
        const pid = String(it.productId || '')
        const p = productsById[pid]
        if (!p || normalizeKey(p.type) !== 'juice') continue
        const unitsPerPackage = Number(p.unitsPerPackage ?? p.unitsPerPack ?? 1)
        const packages = Number(it.qtyPackages ?? it.qty ?? 0)
        totalBottles += packages * (Number.isFinite(unitsPerPackage) && unitsPerPackage > 0 ? unitsPerPackage : 1)
      }
    }
    const currentTier = JUICE_TIERS.reduce((best, t) => (totalBottles >= t.min ? t : best), JUICE_TIERS[0])
    const nextTiers = JUICE_TIERS.filter((t) => t.tier > currentTier.tier)
    const progress = nextTiers.map((t) => `${t.min - totalBottles} more bottle${t.min - totalBottles !== 1 ? 's' : ''} to reach Tier ${t.tier} (${t.label} bonus)`)
    return { totalBottles, currentTier, progress }
  }, [orders, productsById, tierMonth])

  const deliveryFeesByRider = useMemo(() => {
    const map: Record<string, number> = {}
    for (const o of paidOrdersInValueRange) {
      const rider = String(o.deliveredBy || 'Unassigned')
      const fee = Number(o.deliveryFee || 0)
      map[rider] = (map[rider] || 0) + (Number.isFinite(fee) ? fee : 0)
    }
    const riders = Object.entries(map)
      .map(([rider, total]) => ({ rider, total }))
      .sort((a, b) => b.total - a.total)
    const totalAmount = riders.reduce((sum, r) => sum + r.total, 0)
    riders.push({ rider: 'TOTAL', total: totalAmount })
    return riders
  }, [paidOrdersInValueRange])

  const deliveredOrdersInRange = useMemo(() => {
    return orders
      .filter((o) => !!o.delivered)
      .filter((o) => withinRange(toDate(o.deliveredAt), rangeStart, rangeEnd))
  }, [orders, rangeStart, rangeEnd])

  const riderDeliveryRows = useMemo(() => {
    return deliveredOrdersInRange.map((o) => {
      const riderLabelRaw = String(o.deliveredBy || 'Unassigned').trim()
      const riderLabel = riderLabelRaw || 'Unassigned'
      const deliveryDate = toDateKey(o.deliveredAt) || '-'
      const c = customers.find((cc) => cc.id === o.customerId) || null
      const addressLineRaw = [c?.deliveryAddress1, c?.deliveryAddress2].filter(Boolean).join(', ').trim()
      const cityOnlyRaw = String(c?.city || '').trim()
      const locationLabel = (addressLineRaw || cityOnlyRaw) || 'Unknown'
      return {
        id: o.id,
        orderId: o.id,
        customerName: c?.name || o.customerId || 'Unknown',
        location: locationLabel,
        deliveryCharge: Number(o.deliveryFee || 0),
        rider: riderLabel,
        deliveryDate,
        riderKey: normalizeKey(riderLabel),
        locationKey: normalizeKey(locationLabel),
      }
    })
  }, [deliveredOrdersInRange, customers])

  type GroupField = 'location' | 'date' | 'rider'
  type GroupNode = { key: string; label: string; total: number; field: GroupField; children?: GroupNode[]; rows?: any[] }

  const groupFieldLabels: Record<GroupField, string> = { location: 'Location', date: 'Date', rider: 'Rider' }
  const groupFieldOrder: GroupField[] = ['location', 'date', 'rider']

  const selectedGroupFields = useMemo(
    () => groupFieldOrder.filter((field) => riderReportFields[field]),
    [riderReportFields],
  )

  const buildRiderDeliveryGroups = (
    rows: Array<{ riderKey: string; rider: string; locationKey: string; location: string; deliveryDate: string; deliveryCharge: number }>,
    fields: GroupField[],
    level = 0,
  ): GroupNode[] => {
    const field = fields[level]
    if (!field) return []

    const isDateKey = (k: string) => /^\d{4}-\d{2}-\d{2}$/.test(k)
    const compareKeys = (a: { key: string; label: string }, b: { key: string; label: string }) => {
      if (isDateKey(a.key) && isDateKey(b.key)) return a.key.localeCompare(b.key)
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
    }

    const groups: Record<string, { key: string; label: string; total: number; rows: any[] }> = {}

    for (const row of rows) {
      let key = ''
      let label = ''
      if (field === 'location') {
        key = row.locationKey || 'unknown'
        label = row.location || 'Unknown'
      } else if (field === 'date') {
        key = row.deliveryDate || 'unknown'
        label = row.deliveryDate || 'Unknown'
      } else {
        key = row.riderKey || 'unknown'
        label = row.rider || 'Unassigned'
      }

      if (!groups[key]) {
        groups[key] = { key, label, total: 0, rows: [] }
      }
      const fee = Number(row.deliveryCharge || 0)
      groups[key].total += Number.isFinite(fee) ? fee : 0
      groups[key].rows.push(row)
    }

    return Object.values(groups)
      .map((group) => {
        const node: GroupNode = { key: group.key, label: group.label, total: group.total, field }
        if (fields[level + 1]) {
          node.children = buildRiderDeliveryGroups(group.rows, fields, level + 1)
        } else {
          node.rows = group.rows
        }
        return node
      })
      .sort(compareKeys)
  }

  const riderDeliveryGroups = useMemo(
    () => (selectedGroupFields.length ? buildRiderDeliveryGroups(riderDeliveryRows, selectedGroupFields) : []),
    [riderDeliveryRows, selectedGroupFields],
  )

  const buildRiderDeliveryExportRows = (
    fields: GroupField[],
    groups: GroupNode[],
    includeGroupingLabel: boolean,
  ) => {
    if (!fields.length || !groups.length) return [] as Array<Record<string, any>>
    const groupingLabel = fields.map((field) => groupFieldLabels[field]).join(' -> ')
    const rows: Array<Record<string, any>> = []

    const pushGroupRows = (nodes: GroupNode[], path: Record<string, string>) => {
      for (const node of nodes) {
        const nextPath = { ...path, [groupFieldLabels[node.field]]: node.label }
        if (node.children && node.children.length) {
          pushGroupRows(node.children, nextPath)
          rows.push({
            ...(includeGroupingLabel ? { Grouping: groupingLabel } : {}),
            ...nextPath,
            'Customer Name': 'Group Total',
            'Customer Location': '',
            'Delivery Charge': Number(node.total || 0).toFixed(2),
            'Rider Name': '',
            'Delivery Date': '',
          })
        } else if (node.rows) {
          for (const row of node.rows) {
            rows.push({
              ...(includeGroupingLabel ? { Grouping: groupingLabel } : {}),
              ...nextPath,
              'Customer Name': row.customerName,
              'Customer Location': row.location,
              'Delivery Charge': Number(row.deliveryCharge || 0).toFixed(2),
              'Rider Name': row.rider,
              'Delivery Date': row.deliveryDate,
            })
          }
          rows.push({
            ...(includeGroupingLabel ? { Grouping: groupingLabel } : {}),
            ...nextPath,
            'Customer Name': 'Subtotal',
            'Customer Location': '',
            'Delivery Charge': Number(node.total || 0).toFixed(2),
            'Rider Name': '',
            'Delivery Date': '',
          })
        }
      }
    }

    pushGroupRows(groups, {})
    const grandTotal = groups.reduce((sum, group) => sum + Number(group.total || 0), 0)
    rows.push({
      ...(includeGroupingLabel ? { Grouping: groupingLabel } : {}),
      'Customer Name': 'Grand Total',
      'Customer Location': '',
      'Delivery Charge': Number(grandTotal || 0).toFixed(2),
      'Rider Name': '',
      'Delivery Date': '',
    })
    return rows
  }

  const riderDeliveryExportRows = useMemo(
    () => buildRiderDeliveryExportRows(selectedGroupFields, riderDeliveryGroups, false),
    [riderDeliveryGroups, selectedGroupFields],
  )

  const riderDeliveryExportAllRows = useMemo(() => {
    if (!selectedGroupFields.length) return [] as Array<Record<string, any>>
    const allRows: Array<Record<string, any>> = []
    const comboFields: GroupField[][] = []
    const buildCombos = (start: number, path: GroupField[]) => {
      if (path.length) comboFields.push([...path])
      for (let i = start; i < selectedGroupFields.length; i += 1) {
        path.push(selectedGroupFields[i])
        buildCombos(i + 1, path)
        path.pop()
      }
    }
    buildCombos(0, [])
    for (const fields of comboFields) {
      const groups = buildRiderDeliveryGroups(riderDeliveryRows, fields)
      allRows.push(...buildRiderDeliveryExportRows(fields, groups, true))
    }
    return allRows
  }, [riderDeliveryRows, selectedGroupFields])

  /* ── Expenses in range — valueDate with fallback ── */
  const expensesInRange = useMemo(() => {
    return expenses.filter((e) => withinRange(toDate(e.valueDate) || toDate(e.date) || toDate(e.createdAt), rangeStart, rangeEnd))
  }, [expenses, rangeStart, rangeEnd])

  const expensesByType = useMemo(() => {
    const map: Record<string, { type: string; count: number; total: number }> = {}
    for (const e of expensesInRange) {
      const type = String(e.name || 'Other')
      if (!map[type]) {
        map[type] = { type, count: 0, total: 0 }
      }
      map[type].count += 1
      map[type].total += Number(e.amount || 0)
    }
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [expensesInRange])

  const filteredExpensesByType = useMemo(() => {
    if (!expenseSearch.trim()) return expensesByType
    const q = expenseSearch.trim().toLowerCase()
    return expensesByType.filter((e) => e.type.toLowerCase().includes(q))
  }, [expensesByType, expenseSearch])

  const cumulativeCashSeries = useMemo(() => {
    if (!startKey || !endKey) return [] as Array<{ dateKey: string; cumRevenue: number; cumExpense: number }>
    const start = new Date(startKey)
    const end = new Date(endKey)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return []

    const revenueByDay: Record<string, number> = {}
    for (const o of paidOrdersInValueRange) {
      const k = toDateKey(o.valueDate) || toDateKey(o.createdAt) || toDateKey(o.date)
      if (!k || k < startKey || k > endKey) continue
      const net = Number(o.amountPaid || 0) - Number(o.deliveryFee || 0)
      revenueByDay[k] = (revenueByDay[k] || 0) + (Number.isFinite(net) ? net : 0)
    }

    const expenseByDay: Record<string, number> = {}
    for (const e of expensesInRange) {
      const k = toDateKey(e.valueDate) || toDateKey(e.date) || toDateKey(e.createdAt)
      if (!k || k < startKey || k > endKey) continue
      const amt = Number(e.amount || 0)
      expenseByDay[k] = (expenseByDay[k] || 0) + (Number.isFinite(amt) ? amt : 0)
    }

    const points: Array<{ dateKey: string; cumRevenue: number; cumExpense: number }> = []
    let cumRevenue = 0
    let cumExpense = 0
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const k = fmtDate(d)
      const rev = Number(revenueByDay[k] || 0)
      const exp = Number(expenseByDay[k] || 0)
      cumRevenue += Number.isFinite(rev) ? rev : 0
      cumExpense += Number.isFinite(exp) ? exp : 0
      points.push({ dateKey: k, cumRevenue, cumExpense })
    }
    return points
  }, [startKey, endKey, paidOrdersInValueRange, expensesInRange])

  const depreciationByPeriod = useMemo(() => {
    const map = Object.fromEntries(buildPeriodBuckets(rangeStart, rangeEnd, trendGranularity).map((bucket) => [bucket.key, 0])) as Record<string, number>
    for (let day = startOfDay(rangeStart); day <= startOfDay(rangeEnd); day = addDays(day, 1)) {
      const bucket = getPeriodBucket(day, trendGranularity)
      map[bucket.key] = (map[bucket.key] || 0) + dailyDepreciationForDate(day, assets)
    }
    return map
  }, [assets, rangeEnd, rangeStart, trendGranularity])

  const depreciationInRange = useMemo(
    () => Object.values(depreciationByPeriod).reduce((sum, value) => sum + Number(value || 0), 0),
    [depreciationByPeriod],
  )

  const revenue = useMemo(() => ordersInRange.reduce((s, o) => s + Number(o.subtotal || 0), 0), [ordersInRange])
  const expenseTotal = useMemo(() => expensesInRange.reduce((s, e) => s + Number(e.amount || 0), 0), [expensesInRange])
  const cashFlow = useMemo(() => revenue - expenseTotal, [revenue, expenseTotal])
  const pnl = useMemo(() => revenue - expenseTotal - depreciationInRange, [revenue, expenseTotal, depreciationInRange])
  const unpaidCount = useMemo(() => orders.filter((o) => !o.paid).length, [orders])

  const customerLabel = (id: string) => {
    const c = customers.find((cc) => cc.id === id)
    if (!c) return id
    const name = c.name || id
    const tel = [c.telephone1, c.telephone2, c.telephone, c.phone].filter(Boolean).join(' / ')
    const location = [c.deliveryAddress1, c.deliveryAddress2, c.city].filter(Boolean).join(', ')
    return [name, tel, location].filter(Boolean).join(' — ')
  }

  const bestDate = (o: any) => toDate(o.valueDate) || toDate(o.createdAt) || toDate(o.date)
  const bestExpenseDate = (e: any) => toDate(e.valueDate) || toDate(e.date) || toDate(e.createdAt)

  const salesTrend = useMemo(
    () => groupByPeriod(ordersInRange, bestDate, (o) => Number(o.subtotal || 0), trendGranularity, rangeStart, rangeEnd),
    [ordersInRange, rangeEnd, rangeStart, trendGranularity],
  )
  const salesTrendUnits = useMemo(
    () =>
      groupByPeriod(
        ordersInRange,
        bestDate,
        (o) => (o.items || []).reduce((s: number, it: any) => s + (it.qtyPackages || 0) * (it.unitsPerPackage || 1), 0),
        trendGranularity,
        rangeStart,
        rangeEnd,
      ),
    [ordersInRange, rangeEnd, rangeStart, trendGranularity],
  )
  const salesTrendOrders = useMemo(
    () => groupByPeriod(ordersInRange, bestDate, () => 1, trendGranularity, rangeStart, rangeEnd),
    [ordersInRange, rangeEnd, rangeStart, trendGranularity],
  )
  const expenseTrend = useMemo(
    () => groupByPeriod(expensesInRange, bestExpenseDate, (e) => Number(e.amount || 0), trendGranularity, rangeStart, rangeEnd),
    [expensesInRange, rangeEnd, rangeStart, trendGranularity],
  )

  const pnlTrend = useMemo(() => {
    const revenueMap = groupByPeriod(ordersInRange, bestDate, (o) => Number(o.subtotal || 0), trendGranularity, rangeStart, rangeEnd)
    const expenseMap = groupByPeriod(expensesInRange, bestExpenseDate, (e) => Number(e.amount || 0), trendGranularity, rangeStart, rangeEnd)
    const sortMap = Object.fromEntries(buildPeriodBuckets(rangeStart, rangeEnd, trendGranularity).map((bucket) => [bucket.label, bucket.sort])) as Record<string, number>
    const map: Record<string, { rev: number; exp: number; depr: number; revItems: any[]; expItems: any[] }> = {}
    revenueMap.forEach((r) => { map[r.period] = { rev: r.total, exp: 0, depr: 0, revItems: r.items, expItems: [] } })
    expenseMap.forEach((e) => { if (!map[e.period]) map[e.period] = { rev: 0, exp: 0, depr: 0, revItems: [], expItems: [] }; map[e.period].exp += e.total; map[e.period].expItems.push(...e.items) })
    Object.keys(map).forEach((period) => { map[period].depr = depreciationByPeriod[period] || 0 })
    return Object.entries(map)
      .sort(([a], [b]) => (sortMap[a] || 0) - (sortMap[b] || 0) || a.localeCompare(b))
      .map(([period, v]) => ({ period, total: v.rev - v.exp - v.depr, items: [...v.revItems, ...v.expItems, { depreciation: v.depr }] }))
  }, [depreciationByPeriod, expensesInRange, ordersInRange, rangeEnd, rangeStart, trendGranularity])

  const topCustomers = useMemo(() => {
    const map: Record<string, { revenue: number; volume: number }> = {}
    ordersInRange.forEach((o) => {
      const custId = o.customerId || 'unknown'
      if (!map[custId]) map[custId] = { revenue: 0, volume: 0 }
      map[custId].revenue += Number(o.subtotal || 0)
      const units = (o.items || []).reduce((s: any, it: any) => s + (it.qtyPackages || 0) * (it.unitsPerPackage || 1), 0)
      map[custId].volume += units
    })
    return Object.entries(map)
      .map(([id, val]) => ({ id, name: customerLabel(id), ...val }))
      .sort((a, b) => (viewMode === 'revenue' ? b.revenue - a.revenue : b.volume - a.volume))
      .slice(0, 10)
  }, [ordersInRange, customers, viewMode])

  const customerById = useMemo(() => {
    const map: Record<string, any> = {}
    for (const c of customers) {
      if (!c?.id) continue
      map[String(c.id)] = c
    }
    return map
  }, [customers])

  const categoryLabelMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const row of customerCategories) {
      if (!row?.code) continue
      map[String(row.code)] = String(row.label || row.code)
    }
    return map
  }, [customerCategories])

  const allergyLabelMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const row of customerAllergies) {
      if (!row?.code) continue
      map[String(row.code)] = String(row.label || row.code)
    }
    return map
  }, [customerAllergies])

  const customerCategoriesAgg = useMemo(() => {
    const base: Record<string, { code: string; label: string; customers: any[] }> = {}
    for (const master of customerCategories) {
      const code = String(master.code || '')
      if (!code) continue
      base[code] = { code, label: String(master.label || code), customers: [] }
    }

    for (const c of customers) {
      const codes: string[] = Array.isArray(c.categoryCodes) ? c.categoryCodes : []
      for (const code of codes) {
        const key = String(code)
        if (!base[key]) base[key] = { code: key, label: categoryLabelMap[key] || key, customers: [] }
        base[key].customers.push(c)
      }
    }

    return Object.values(base)
      .map((row) => ({
        code: row.code,
        label: row.label,
        customerCount: new Set((row.customers || []).map((c: any) => c.id)).size,
        customers: row.customers || [],
      }))
      .sort((a, b) => b.customerCount - a.customerCount || a.label.localeCompare(b.label))
  }, [customers, customerCategories, categoryLabelMap])

  const customerAllergiesAgg = useMemo(() => {
    const base: Record<string, { code: string; label: string; customers: any[] }> = {}
    for (const master of customerAllergies) {
      const code = String(master.code || '')
      if (!code) continue
      base[code] = { code, label: String(master.label || code), customers: [] }
    }

    for (const c of customers) {
      const codes: string[] = Array.isArray(c.allergyCodes) ? c.allergyCodes : []
      for (const code of codes) {
        const key = String(code)
        if (!base[key]) base[key] = { code: key, label: allergyLabelMap[key] || key, customers: [] }
        base[key].customers.push(c)
      }
    }

    return Object.values(base)
      .map((row) => ({
        code: row.code,
        label: row.label,
        customerCount: new Set((row.customers || []).map((c: any) => c.id)).size,
        customers: row.customers || [],
      }))
      .sort((a, b) => b.customerCount - a.customerCount || a.label.localeCompare(b.label))
  }, [customers, customerAllergies, allergyLabelMap])

  const categoryTransactionAgg = useMemo(() => {
    const map: Record<string, { code: string; label: string; customerIds: Set<string>; transactionVolume: number; transactionValue: number }> = {}

    for (const row of customerCategoriesAgg) {
      map[row.code] = {
        code: row.code,
        label: row.label,
        customerIds: new Set((row.customers || []).map((c: any) => String(c.id))),
        transactionVolume: 0,
        transactionValue: 0,
      }
    }

    for (const o of paidOrdersInValueRange) {
      const customer = customerById[String(o.customerId || '')]
      if (!customer) continue
      const codes: string[] = Array.isArray(customer.categoryCodes) ? customer.categoryCodes : []
      const orderAmountPaid = Number(o.amountPaid || 0)

      for (const rawCode of codes) {
        const code = String(rawCode)
        if (!map[code]) {
          map[code] = {
            code,
            label: categoryLabelMap[code] || code,
            customerIds: new Set(),
            transactionVolume: 0,
            transactionValue: 0,
          }
        }
        map[code].customerIds.add(String(customer.id || ''))
        map[code].transactionVolume += 1
        map[code].transactionValue += Number.isFinite(orderAmountPaid) ? orderAmountPaid : 0
      }
    }

    return Object.values(map)
      .map((row) => ({
        code: row.code,
        label: row.label,
        customerCount: row.customerIds.size,
        transactionVolume: row.transactionVolume,
        transactionValue: row.transactionValue,
      }))
      .sort((a, b) => b.transactionValue - a.transactionValue || b.transactionVolume - a.transactionVolume)
  }, [customerCategoriesAgg, paidOrdersInValueRange, customerById, categoryLabelMap])

  const locationAggregates = useMemo(() => {
    const map: Record<string, { key: string; label: string; customers: any[]; customersCount: number; ordersCount: number; ordersAmount: number }> = {}

    for (const c of customers) {
      const cityRaw = String((c?.city) || (c?.deliveryAddress1) || '').trim()
      if (!cityRaw) continue
      const key = cityRaw.toLowerCase()
      if (!map[key]) map[key] = { key, label: cityRaw, customers: [], customersCount: 0, ordersCount: 0, ordersAmount: 0 }
      map[key].customers.push(c)
    }

    for (const o of orders) {
      if (!includeUnpaid && !o.paid) continue
      const cust = customers.find((cc) => cc.id === o.customerId) || null
      const cityRaw = String((cust?.city) || (cust?.deliveryAddress1) || '').trim() || 'Unknown'
      const key = cityRaw.toLowerCase()
      if (!map[key]) map[key] = { key, label: cityRaw, customers: [], customersCount: 0, ordersCount: 0, ordersAmount: 0 }

      let subtotal = Number(o.subtotal ?? NaN)
      if (!Number.isFinite(subtotal)) {
        subtotal = (o.items || []).reduce((s: number, it: any) => {
          const pid = String(it.productId || '')
          const p = pid ? productsById[pid] : null
          const unit = p ? Number(p.price ?? p.unitCost ?? 0) : 0
          const qty = Number(it.qtyPackages ?? it.qty ?? 0)
          return s + unit * qty
        }, 0)
      }
      map[key].ordersCount += 1
      map[key].ordersAmount += Number(subtotal || 0)
    }

    Object.values(map).forEach((loc: any) => {
      loc.customersCount = Array.from(new Set((loc.customers || []).map((c: any) => c.id))).length
    })

    const arr = Object.values(map)
    return arr
      .sort((a: any, b: any) => (locationMode === 'customers' ? b.customersCount - a.customersCount : b.ordersCount - a.ordersCount))
      .slice(0, TOP_LOCATIONS)
  }, [customers, orders, productsById, includeUnpaid, locationMode])

  /* Lapsed customers — use createdAt/date (no valueDate on these) filtered against global range */
  const lapsedCustomers = useMemo(() => {
    const ordersByCustomer: Record<string, Date[]> = {}
    orders.forEach((o) => {
      const d = toDate(o.createdAt) || toDate(o.date)
      if (!d) return
      const arr = ordersByCustomer[o.customerId || 'unknown'] || []
      arr.push(d)
      ordersByCustomer[o.customerId || 'unknown'] = arr
    })
    const start = rangeStart
    const end = rangeEnd
    const results: { id: string; name: string; lastOrder: Date }[] = []
    Object.entries(ordersByCustomer).forEach(([custId, dates]) => {
      const hadBefore = dates.some((d) => d < start)
      const hasInRange = dates.some((d) => d >= start && d <= end)
      if (hadBefore && !hasInRange) {
        const lastOrder = dates.sort((a, b) => b.getTime() - a.getTime())[0]
        results.push({ id: custId, name: customers.find((c) => c.id === custId)?.name || custId, lastOrder })
      }
    })
    return results.sort((a, b) => b.lastOrder.getTime() - a.lastOrder.getTime())
  }, [orders, customers, rangeStart, rangeEnd])

  /* ── NEW: Average Order Value (AOV) Trend ── */
  const aovTrend = useMemo(() => {
    const monthMap: Record<string, { revenue: number; count: number }> = {}
    ordersInRange.forEach((o) => {
      const d = bestDate(o)
      if (!d) return
      const key = monthKey(d)
      if (!monthMap[key]) monthMap[key] = { revenue: 0, count: 0 }
      monthMap[key].revenue += Number(o.subtotal || 0)
      monthMap[key].count += 1
    })
    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, data]) => ({
        period,
        total: data.count > 0 ? data.revenue / data.count : 0,
        items: [{ period, totalRevenue: data.revenue, orderCount: data.count, aov: data.count > 0 ? data.revenue / data.count : 0 }],
      }))
  }, [ordersInRange])

  /* ── NEW: Customer Retention ── */
  const customerRetention = useMemo(() => {
    const map: Record<string, { orders: number; revenue: number }> = {}
    ordersInRange.forEach((o) => {
      const custId = o.customerId || 'unknown'
      if (!map[custId]) map[custId] = { orders: 0, revenue: 0 }
      map[custId].orders += 1
      map[custId].revenue += Number(o.subtotal || 0)
    })
    const entries = Object.entries(map).map(([id, data]) => ({
      id,
      name: customerLabel(id),
      orders: data.orders,
      revenue: data.revenue,
    }))
    const total = entries.length
    const newCustomers = entries.filter((e) => e.orders === 1)
    const repeatCustomers = entries.filter((e) => e.orders > 1).sort((a, b) => b.orders - a.orders)
    const repeatRate = total > 0 ? (repeatCustomers.length / total) * 100 : 0
    return { total, newCount: newCustomers.length, repeatCount: repeatCustomers.length, repeatRate, repeatCustomers }
  }, [ordersInRange, customers])

  const filteredRiders = useMemo(() => {
    if (!riderSearch.trim()) return deliveryFeesByRider
    const q = riderSearch.trim().toLowerCase()
    return deliveryFeesByRider.filter((r) => r.rider.toLowerCase().includes(q))
  }, [deliveryFeesByRider, riderSearch])

  const filteredTopCustomers = useMemo(() => {
    if (!customerSearch.trim()) return topCustomers
    const q = customerSearch.trim().toLowerCase()
    return topCustomers.filter((c) => c.name.toLowerCase().includes(q))
  }, [topCustomers, customerSearch])

  const filteredLapsed = useMemo(() => {
    if (!lapsedSearch.trim()) return lapsedCustomers
    const q = lapsedSearch.trim().toLowerCase()
    return lapsedCustomers.filter((c) => c.name.toLowerCase().includes(q))
  }, [lapsedCustomers, lapsedSearch])

  const filteredPayments = useMemo(() => {
    if (!paymentSearch.trim()) return recentPayments
    const q = paymentSearch.trim().toLowerCase()
    return recentPayments.filter((p) => {
      const custName = customerLabel(p.customerId).toLowerCase()
      const orderId = String(p.orderId || '').toLowerCase()
      return custName.includes(q) || orderId.includes(q)
    })
  }, [recentPayments, paymentSearch, customers])

  const filteredRepeatCustomers = useMemo(() => {
    if (!repeatSearch.trim()) return customerRetention.repeatCustomers
    const q = repeatSearch.trim().toLowerCase()
    return customerRetention.repeatCustomers.filter((c) => c.name.toLowerCase().includes(q))
  }, [customerRetention.repeatCustomers, repeatSearch])

  /* ── Export handler ──────────────────────── */
  const handleExport = (kind: 'revenue' | 'expense' | 'cashflow' | 'pnl') => {
    switch (kind) {
      case 'revenue':
        return exportExcel('revenue.xlsx', ordersInRange.map((o) => ({ id: o.id, date: fmtDate(bestDate(o)), customer: customerLabel(o.customerId), amount: Number(o.subtotal || 0).toFixed(2), paid: o.paid ? 'yes' : 'no' })))
      case 'expense':
        return exportExcel('expenses.xlsx', expensesInRange.map((e) => ({ id: e.id, date: fmtDate(bestExpenseDate(e)), name: e.name, amount: Number(e.amount || 0).toFixed(2), appliesTo: (e.appliesTo || []).join('|'), narration: e.narration || '' })))
      case 'pnl':
        return exportExcel('pnl.xlsx', [{ revenue: revenue.toFixed(2), expenses: expenseTotal.toFixed(2), depreciation: depreciationInRange.toFixed(2), pnl: pnl.toFixed(2) }])
      case 'cashflow':
        return exportExcel('cashflow.xlsx', [{ inflow: revenue.toFixed(2), outflow: expenseTotal.toFixed(2), net: cashFlow.toFixed(2) }])
    }
  }

  /* ── Product bar-chart data ────────────────── */
  const palette = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#06b6d4', '#84cc16', '#e11d48', '#6366f1', '#0ea5e9']

  const barData = useMemo(
    () =>
      filteredProductsSoldAgg
        .filter((p) => Number(p.units || 0) > 0)
        .slice(0, 12)
        .map((p, i) => ({
          id: `prod:${p.productId}`,
          label: p.name,
          quantity: Number(p.units || 0),
          amount: Number(p.amount || 0),
          orders: productOrderCounts[p.productId] || 0,
          color: palette[i % palette.length],
        })),
    [filteredProductsSoldAgg, productOrderCounts],
  )

  const openProductDrilldown = (barIdOrProductId: string) => {
    const productId = barIdOrProductId.startsWith('prod:') ? barIdOrProductId.slice('prod:'.length) : barIdOrProductId
    const productName = productsById[productId]?.name || productId
    const rows = paidOrdersInValueRange
      .filter((o) => (o.items || []).some((it: any) => String(it.productId || '') === productId))
      .map((o) => {
        const c = customers.find((cc) => cc.id === o.customerId) || null
        let productPackages = 0
        let productUnits = 0
        let productAmount = 0
        for (const it of o.items || []) {
          const itProductId = String(it.productId || '')
          if (!itProductId) continue
          const p = productsById[itProductId] || null
          const unitCost = Number(p?.price ?? p?.unitCost ?? 0)
          const unitsPerPackage = Number(p?.unitsPerPackage ?? p?.unitsPerPack ?? 1)
          const packages = Number(it.qtyPackages ?? it.qty ?? 0)
          const units = packages * (Number.isFinite(unitsPerPackage) && unitsPerPackage > 0 ? unitsPerPackage : 1)
          if (itProductId === productId) {
            productPackages += packages
            productUnits += units
            productAmount += packages * unitCost
          }
        }
        return {
          id: o.id,
          orderId: o.id,
          valueDate: toDateKey(o.valueDate) || '-',
          customerName: c?.name || o.customerId || 'Unknown',
          customerPhone: [c?.telephone1, c?.telephone2, c?.telephone, c?.phone].filter(Boolean).join(' / '),
          customerLocation: [c?.deliveryAddress1, c?.deliveryAddress2, c?.city].filter(Boolean).join(', '),
          productPackages,
          productUnits,
          productAmount,
          rider: String(o.deliveredBy || ''),
          status: String(o.status || ''),
        }
      })
    setDrilldown({ title: `Orders — ${productName} (${startDate} to ${endDate})`, rows })
  }

  const openPostingProductDrilldown = (row: any) => {
    const productId = String(row.productId || '')
    const postingDate = String(row.postingDate || '')
    const productName = productsById[productId]?.name || productId
    const rows = orders
      .filter((o) => !!o.paid)
      .filter((o) => fmtDate(toDate(o.createdAt) || toDate(o.date) || toDate(o.valueDate)) === postingDate)
      .map((o) => {
        const c = customers.find((cc) => cc.id === o.customerId) || null
        let productPackages = 0
        let productUnits = 0
        for (const it of o.items || []) {
          const itProductId = String(it.productId || '')
          if (itProductId !== productId) continue
          const p = productsById[itProductId] || null
          const unitsPerPackage = Number(p?.unitsPerPackage ?? p?.unitsPerPack ?? 1)
          const packages = Number(it.qtyPackages ?? it.qty ?? 0)
          const units = packages * (Number.isFinite(unitsPerPackage) && unitsPerPackage > 0 ? unitsPerPackage : 1)
          productPackages += packages
          productUnits += units
        }
        return {
          id: o.id,
          orderId: o.id,
          postingDate,
          customerName: c?.name || o.customerId || 'Unknown',
          customerPhone: [c?.telephone1, c?.telephone2, c?.telephone, c?.phone].filter(Boolean).join(' / '),
          customerLocation: [c?.deliveryAddress1, c?.deliveryAddress2, c?.city].filter(Boolean).join(', '),
          packages: productPackages,
          unitCount: productUnits,
          amountPaid: Number(o.amountPaid || 0),
          rider: String(o.deliveredBy || ''),
          status: String(o.status || ''),
        }
      })
      .filter((r) => Number(r.packages || 0) > 0)
    setDrilldown({ title: `Posting Details — ${postingDate} — ${productName}`, rows })
  }

  /* ── Styles ──────────────────────────────── */
  const labelStyle = { display: 'block', marginBottom: 6, fontWeight: 600, color: '#1f2937' }
  const inputStyle = { width: '100%' }
  const rowStyle = { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' } as const satisfies React.CSSProperties

  const stat = (label: string, value: string) => (
    <div style={{ flex: '1 1 200px', background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)', borderRadius: 12, padding: 16, border: '2px solid #e2e8f0', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: '#1e293b' }}>{value}</div>
    </div>
  )

  const ExcelBtn = ({ onClick, label }: { onClick: () => void; label?: string }) => (
    <button className="btn" onClick={onClick} style={{ fontSize: 12, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }} title="Download Excel">
      ⬇ {label || 'Excel'}
    </button>
  )

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const riderDeliveryGrandTotal = useMemo(
    () => riderDeliveryGroups.reduce((sum, group) => sum + Number(group.total || 0), 0),
    [riderDeliveryGroups],
  )

  const renderDeliveryTable = (rows: any[], total: number) => (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '8px 10px' }}>Customer</th>
            <th style={{ textAlign: 'left', padding: '8px 10px' }}>Location</th>
            <th style={{ textAlign: 'right', padding: '8px 10px' }}>Delivery Charge</th>
            <th style={{ textAlign: 'left', padding: '8px 10px' }}>Rider</th>
            <th style={{ textAlign: 'left', padding: '8px 10px' }}>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: '8px 10px' }}>{row.customerName}</td>
              <td style={{ padding: '8px 10px' }}>{row.location}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmtCurrency(Number(row.deliveryCharge || 0))}</td>
              <td style={{ padding: '8px 10px' }}>{row.rider}</td>
              <td style={{ padding: '8px 10px' }}>{row.deliveryDate}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb' }}>
            <td style={{ padding: '8px 10px', fontWeight: 700 }}>Subtotal</td>
            <td />
            <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>{fmtCurrency(Number(total || 0))}</td>
            <td />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  )

  const renderGroupNodes = (nodes: GroupNode[], level = 0) => (
    nodes.map((group) => (
      <div
        key={`${group.field}:${group.key}`}
        style={{
          border: level === 0 ? '1px solid #e5e7eb' : 'none',
          borderRadius: level === 0 ? 12 : 0,
          padding: level === 0 ? 12 : 0,
          marginBottom: level === 0 ? 16 : 12,
          marginLeft: level > 0 ? 12 : 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, color: '#111827' }}>{groupFieldLabels[group.field]}: {group.label}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Total delivery fees: {fmtCurrency(Number(group.total || 0))}</div>
        </div>
        {group.children && group.children.length ? (
          renderGroupNodes(group.children, level + 1)
        ) : (
          renderDeliveryTable(group.rows || [], group.total)
        )}
      </div>
    ))
  )

  /* ── Inline Chart Components ─────────────── */

  const TrendChart = ({ data, formatter, onPointClick }: { data: { period: string; total: number; items: any[] }[]; formatter?: (n: number) => string; onPointClick: (d: any) => void }) => {
    if (!data.length) return <p style={{ fontSize: 12, color: '#6b7280' }}>No data</p>
    const width = 700, height = 180, pad = 16
    const values = data.map((d) => d.total)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = max - min || 1
    const points = data.map((d, i) => {
      const x = pad + (i / Math.max(1, data.length - 1)) * (width - 2 * pad)
      const y = pad + (1 - (d.total - min) / span) * (height - 2 * pad)
      return { x, y, d }
    })
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxWidth: width, background: '#f9fafb', borderRadius: 12, border: '1px solid #eef2f7' }}>
        <path d={path} fill="none" stroke="#2563eb" strokeWidth={2} />
        {points.map((p, idx) => (
          <g key={idx} onClick={() => onPointClick(p.d)} style={{ cursor: 'pointer' }}>
            <circle cx={p.x} cy={p.y} r={4} fill="#2563eb" />
            <title>{`${p.d.period}: ${formatter ? formatter(p.d.total) : p.d.total}`}</title>
          </g>
        ))}
      </svg>
    )
  }

  const CumulativeLinesChart = ({ title, points }: { title: string; points: Array<{ dateKey: string; cumRevenue: number; cumExpense: number }> }) => {
    if (!points.length) return <p style={{ fontSize: 12, color: '#6b7280' }}>No data</p>
    const width = 700, height = 200, pad = 16
    const maxVal = Math.max(...points.map((p) => Math.max(Number(p.cumRevenue || 0), Number(p.cumExpense || 0))))
    const span = maxVal || 1

    const xy = (i: number, val: number) => {
      const x = pad + (i / Math.max(1, points.length - 1)) * (width - 2 * pad)
      const y = pad + (1 - val / span) * (height - 2 * pad)
      return { x, y }
    }

    const revenuePath = points.map((p, i) => { const { x, y } = xy(i, Number(p.cumRevenue || 0)); return `${i === 0 ? 'M' : 'L'}${x},${y}` }).join(' ')
    const expensePath = points.map((p, i) => { const { x, y } = xy(i, Number(p.cumExpense || 0)); return `${i === 0 ? 'M' : 'L'}${x},${y}` }).join(' ')

    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h4 style={{ margin: '8px 0' }}>{title}</h4>
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#6b7280' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#16a34a', borderRadius: 2, marginRight: 6 }} />Revenue (net)</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#dc2626', borderRadius: 2, marginRight: 6 }} />Expense</span>
          </div>
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', maxWidth: width, background: '#f9fafb', borderRadius: 12, border: '1px solid #eef2f7' }}>
          <path d={revenuePath} fill="none" stroke="#16a34a" strokeWidth={2.5} />
          <path d={expensePath} fill="none" stroke="#dc2626" strokeWidth={2.5} />
          {points.map((p, i) => {
            const rev = xy(i, Number(p.cumRevenue || 0))
            const exp = xy(i, Number(p.cumExpense || 0))
            return (
              <g key={p.dateKey}>
                <circle cx={rev.x} cy={rev.y} r={2.5} fill="#16a34a"><title>{`${p.dateKey}\nRevenue (net): ${fmtCurrency(Number(p.cumRevenue || 0))}`}</title></circle>
                <circle cx={exp.x} cy={exp.y} r={2.5} fill="#dc2626"><title>{`${p.dateKey}\nExpense: ${fmtCurrency(Number(p.cumExpense || 0))}`}</title></circle>
              </g>
            )
          })}
        </svg>
        <p style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>Revenue is (Amount Paid - Delivery Fee). Both lines are cumulative within the selected date range.</p>
      </div>
    )
  }

  const BarChart = ({ title, data, mode, onBarClick }: { title: string; data: { id: string; label: string; quantity: number; amount: number; orders?: number; color: string }[]; mode: 'amount' | 'quantity' | 'orders' | 'both' | 'all' | 'none'; onBarClick?: (id: string) => void }) => {
    if (!data.length || mode === 'none') return <p style={{ fontSize: 12, color: '#6b7280' }}>No data</p>
    const width = 600
    const height = 300
    const margin = { top: 20, right: 30, bottom: 60, left: 60 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const showAmount = mode === 'amount' || mode === 'both' || mode === 'all'
    const showQuantity = mode === 'quantity' || mode === 'both' || mode === 'all'
    const showOrders = mode === 'orders' || mode === 'all'

    const maxAmount = showAmount ? Math.max(...data.map((d) => d.amount)) : 0
    const maxQuantity = showQuantity ? Math.max(...data.map((d) => d.quantity)) : 0
    const maxOrders = showOrders ? Math.max(...data.map((d) => d.orders || 0)) : 0

    const amountScale = showAmount ? (val: number) => (val / maxAmount) * innerHeight : () => 0
    const quantityScale = showQuantity ? (val: number) => (val / maxQuantity) * innerHeight : () => 0
    const ordersScale = showOrders ? (val: number) => (val / maxOrders) * innerHeight : () => 0

    const barCount = (showAmount ? 1 : 0) + (showQuantity ? 1 : 0) + (showOrders ? 1 : 0)
    const barWidth = Math.min(30, innerWidth / data.length / barCount)
    const groupWidth = barWidth * barCount + (barCount - 1) * 5

    return (
      <div>
        {title && <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>}
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', maxWidth: width }}>
          {showAmount && <text x={margin.left - 10} y={margin.top + 10} textAnchor="end" fontSize="12" fill="#6b7280">Amount</text>}
          {showQuantity && !showAmount && <text x={margin.left - 10} y={margin.top + 10} textAnchor="end" fontSize="12" fill="#6b7280">Quantity</text>}
          {showOrders && !showAmount && !showQuantity && <text x={margin.left - 10} y={margin.top + 10} textAnchor="end" fontSize="12" fill="#6b7280">Orders</text>}
          {data.map((d, i) => {
            const x = margin.left + i * groupWidth + (innerWidth - data.length * groupWidth) / 2
            const clickable = !!onBarClick
            let barIndex = 0
            return (
              <g key={d.id}>
                {showAmount && (
                  <rect x={x + barIndex * (barWidth + 5)} y={margin.top + innerHeight - amountScale(d.amount)} width={barWidth} height={amountScale(d.amount)} fill={d.color} stroke="#fff" strokeWidth={1} onClick={clickable ? () => onBarClick?.(d.id) : undefined} style={{ cursor: clickable ? 'pointer' : 'default' }}>
                    <title>{`${d.label}: ${fmtCurrency(d.amount)}`}</title>
                  </rect>
                )}
                {showAmount && (barIndex += 1)}
                {showQuantity && (
                  <rect x={x + barIndex * (barWidth + 5)} y={margin.top + innerHeight - quantityScale(d.quantity)} width={barWidth} height={quantityScale(d.quantity)} fill={d.color} fillOpacity={barCount > 1 ? 0.7 : 1} stroke="#fff" strokeWidth={1} onClick={clickable ? () => onBarClick?.(d.id) : undefined} style={{ cursor: clickable ? 'pointer' : 'default' }}>
                    <title>{`${d.label}: ${d.quantity.toLocaleString()} units`}</title>
                  </rect>
                )}
                {showQuantity && (barIndex += 1)}
                {showOrders && (
                  <rect x={x + barIndex * (barWidth + 5)} y={margin.top + innerHeight - ordersScale(d.orders || 0)} width={barWidth} height={ordersScale(d.orders || 0)} fill={d.color} fillOpacity={barCount > 1 ? 0.5 : 1} stroke="#fff" strokeWidth={1} onClick={clickable ? () => onBarClick?.(d.id) : undefined} style={{ cursor: clickable ? 'pointer' : 'default' }}>
                    <title>{`${d.label}: ${(d.orders || 0).toLocaleString()} orders`}</title>
                  </rect>
                )}
                <text x={x + groupWidth / 2} y={height - margin.bottom + 15} textAnchor="middle" fontSize="11" fill="#374151" transform={`rotate(45, ${x + groupWidth / 2}, ${height - margin.bottom + 15})`}>
                  {d.label.length > 10 ? d.label.substring(0, 10) + '...' : d.label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    )
  }

  /* ── TrendTable — combines chart + grid + optional Excel export ── */

  const TrendTable = ({ title, data, formatter, exportName, showGranularityPicker = false }: { title: string; data: { period: string; total: number; items: any[] }[]; formatter?: (n: number) => string; exportName?: string; showGranularityPicker?: boolean }) => {
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h4 style={{ margin: '8px 0' }}>{title}</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {exportName && <ExcelBtn onClick={() => exportExcel(exportName, data.map((d) => ({ period: d.period, total: d.total })))} />}
            <span style={{ fontSize: 12, color: '#6b7280' }}>Click a point or use Details to drill in</span>
          </div>
        </div>
        {showGranularityPicker && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>Group by</span>
            {TREND_GRANULARITY_OPTIONS.map((option) => (
              <label key={option.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="trend-granularity"
                  value={option.value}
                  checked={trendGranularity === option.value}
                  onChange={() => setTrendGranularity(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        )}
        <TrendChart data={data} formatter={formatter} onPointClick={(d) => setDrilldown({ title: `${title} — ${d.period}`, rows: d.items || [] })} />
        <ResponsiveDataGrid
          rows={data.map((d) => ({ id: d.period, ...d }))}
          columns={
            [
              { field: 'period', headerName: 'Period', width: 140 },
              { field: 'total', headerName: 'Total', flex: 1, minWidth: 160, valueGetter: (_v: any, row: any) => (formatter ? formatter(Number(row.total || 0)) : row.total) },
              {
                field: 'actions', headerName: 'Actions', width: 120, sortable: false, filterable: false,
                renderCell: (params: any) => (<button className="btn" type="button" onClick={() => setDrilldown({ title: `${title} — ${params.row.period}`, rows: params.row.items || [] })}>Details</button>),
              },
            ] as GridColDef<any>[]
          }
          cardTitle={(row: any) => row.period}
          cardFields={[{ label: 'Total', value: (row: any) => (formatter ? formatter(Number(row.total || 0)) : row.total) }]}
          cardActions={(row: any) => (<button className="btn" type="button" onClick={() => setDrilldown({ title: `${title} — ${row.period}`, rows: row.items || [] })}>Details</button>)}
          gridHeight={360}
        />
      </div>
    )
  }

  /* ── Drilldown modal ─────────────────────── */

  const Drilldown = () => {
    if (!drilldown) return null

    const rows = drilldown.rows || []
    if (!rows.length) {
      return (
        <Modal open={true} onClose={() => setDrilldown(null)} title={drilldown.title}>
          <p style={{ color: '#6b7280', fontSize: 14 }}>No data to display</p>
        </Modal>
      )
    }

    const allKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
    const displayKeys = allKeys.filter((k) => k !== 'id' && k !== '__typename')

    const totalKeys = ['amountPaid', 'deliveryFee', 'deliveryAmount', 'netAmount', 'productPackages', 'productUnits', 'allocatedAmountPaid', 'allocatedDeliveryFee', 'productRevenue']
    const showTotals = totalKeys.some((k) => displayKeys.includes(k))
    const totals = showTotals
      ? {
          amountPaid: rows.reduce((s, r) => s + (Number.isFinite(Number(r.amountPaid)) ? Number(r.amountPaid) : 0), 0),
          deliveryFee: rows.reduce((s, r) => s + (Number.isFinite(Number(r.deliveryFee)) ? Number(r.deliveryFee) : 0), 0),
          deliveryAmount: rows.reduce((s, r) => s + (Number.isFinite(Number(r.deliveryAmount)) ? Number(r.deliveryAmount) : 0), 0),
          netAmount: rows.reduce((s, r) => s + (Number.isFinite(Number(r.netAmount)) ? Number(r.netAmount) : 0), 0),
          productPackages: rows.reduce((s, r) => s + (Number.isFinite(Number(r.productPackages)) ? Number(r.productPackages) : 0), 0),
          productUnits: rows.reduce((s, r) => s + (Number.isFinite(Number(r.productUnits)) ? Number(r.productUnits) : 0), 0),
          allocatedAmountPaid: rows.reduce((s, r) => s + (Number.isFinite(Number(r.allocatedAmountPaid)) ? Number(r.allocatedAmountPaid) : 0), 0),
          allocatedDeliveryFee: rows.reduce((s, r) => s + (Number.isFinite(Number(r.allocatedDeliveryFee)) ? Number(r.allocatedDeliveryFee) : 0), 0),
          productRevenue: rows.reduce((s, r) => s + (Number.isFinite(Number(r.productRevenue)) ? Number(r.productRevenue) : 0), 0),
        }
      : null

    return (
      <Modal open={true} onClose={() => setDrilldown(null)} title={drilldown.title}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <ExcelBtn onClick={() => exportExcel(`drilldown-${drilldown.title.replace(/\s+/g, '_')}.xlsx`, rows)} label="Export" />
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                {displayKeys.map((key) => (
                  <th key={key} style={{ padding: '12px 16px', textAlign: 'left', fontWeight: 600, color: '#374151', textTransform: 'capitalize' }}>
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb', transition: 'background 0.2s' }} onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                  {displayKeys.map((key) => {
                    let val = row[key]
                    if (val && typeof val === 'object' && val.toDate) val = fmtDate(val.toDate())
                    else if (val instanceof Date) val = fmtDate(val)
                    else if (typeof val === 'number' && (key.includes('amount') || key.includes('price') || key.includes('cost') || key.includes('total') || key.includes('fee') || key.toLowerCase().includes('revenue') || key.toLowerCase().includes('net') || key.toLowerCase().includes('paid'))) val = fmtCurrency(val)
                    else if (Array.isArray(val)) val = val.join(', ')
                    else if (val && typeof val === 'object') val = JSON.stringify(val)
                    else if (val == null) val = '-'
                    return <td key={key} style={{ padding: '12px 16px', color: '#1f2937' }}>{String(val)}</td>
                  })}
                </tr>
              ))}
            </tbody>
            {showTotals && totals && (
              <tfoot>
                <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb' }}>
                  {displayKeys.map((key, idx) => {
                    let val: any = ''
                    if (idx === 0) val = 'Totals'
                    if (key === 'productPackages') val = Number(totals.productPackages || 0).toLocaleString()
                    if (key === 'productUnits') val = Number(totals.productUnits || 0).toLocaleString()
                    if (key === 'amountPaid') val = fmtCurrency(Number(totals.amountPaid || 0))
                    if (key === 'deliveryFee') val = fmtCurrency(Number(totals.deliveryFee || 0))
                    if (key === 'deliveryAmount') val = fmtCurrency(Number(totals.deliveryAmount || 0))
                    if (key === 'netAmount') val = fmtCurrency(Number(totals.netAmount || 0))
                    if (key === 'allocatedAmountPaid') val = fmtCurrency(Number(totals.allocatedAmountPaid || 0))
                    if (key === 'allocatedDeliveryFee') val = fmtCurrency(Number(totals.allocatedDeliveryFee || 0))
                    if (key === 'productRevenue') val = fmtCurrency(Number(totals.productRevenue || 0))
                    return <td key={key} style={{ padding: '12px 16px', fontWeight: 700, color: '#111827' }}>{String(val)}</td>
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Modal>
    )
  }

  /* ══════════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════════ */

  if (loading) return <div className="card"><p>Loading dashboard...</p></div>

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', padding: isMobile ? '8px 8px 40px' : '8px 16px 40px' }}>
      <h2 style={{ marginTop: 0, marginBottom: 24, fontSize: isMobile ? 24 : 28, color: '#111827', fontWeight: 700 }}>📊 Dashboard</h2>

      {/* ── Global Date Filter Bar ──────────────────────────────────── */}
      <div style={{ background: '#fff', borderRadius: 16, padding: isMobile ? 16 : 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 24, border: '1px solid #e5e7eb' }}>
        <div style={rowStyle}>
          <div style={{ flex: isMobile ? '1 1 100%' : '0 0 180px' }}>
            <label style={labelStyle}>Start date</label>
            <input type="date" className="input" style={inputStyle} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div style={{ flex: isMobile ? '1 1 100%' : '0 0 180px' }}>
            <label style={labelStyle}>End date</label>
            <input type="date" className="input" style={inputStyle} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div style={{ flex: isMobile ? '1 1 100%' : '0 0 180px' }}>
            <label style={labelStyle}>Revenue basis</label>
            <select className="select" style={inputStyle} value={includeUnpaid ? 'all' : 'paid'} onChange={(e) => setIncludeUnpaid(e.target.value === 'all')}>
              <option value="paid">Paid only</option>
              <option value="all">All invoices</option>
            </select>
          </div>
          <div style={{ flex: isMobile ? '1 1 100%' : '0 0 180px' }}>
            <label style={labelStyle}>View mode</label>
            <select className="select" style={inputStyle} value={viewMode} onChange={(e) => setViewMode(e.target.value as any)}>
              <option value="revenue">Revenue</option>
              <option value="volume">Volume</option>
            </select>
          </div>
          <div style={{ flex: '1 1 220px', display: 'flex', gap: 8, alignItems: 'flex-end', flexDirection: isMobile ? 'column' : 'row', width: isMobile ? '100%' : 'auto' }}>
            <button className="btn" onClick={() => handleExport('cashflow')} style={{ flex: isMobile ? 1 : 'none', minWidth: isMobile ? '100%' : 'auto' }}>Generate Cash Flow</button>
            <button className="btn" onClick={() => handleExport('pnl')} style={{ flex: isMobile ? 1 : 'none', minWidth: isMobile ? '100%' : 'auto' }}>Generate P&L</button>
            <button className="btn" onClick={() => handleExport('revenue')} style={{ flex: isMobile ? 1 : 'none', minWidth: isMobile ? '100%' : 'auto' }}>Generate Revenue</button>
            <button className="btn" onClick={() => handleExport('expense')} style={{ flex: isMobile ? 1 : 'none', minWidth: isMobile ? '100%' : 'auto' }}>Generate Expense</button>
          </div>
        </div>
      </div>

      {/* ── Mobile section nav (horizontal scrollable strip) ───────── */}
      {isMobile && (
        <nav style={{ display: 'flex', overflowX: 'auto', gap: 6, marginBottom: 16, padding: '8px 0', WebkitOverflowScrolling: 'touch' }}>
          {sectionNav.map((s) => (
            <button key={s.id} className="btn" onClick={() => scrollTo(s.id)} style={{ whiteSpace: 'nowrap', fontSize: 12, padding: '6px 12px', flexShrink: 0 }}>
              {s.label}
            </button>
          ))}
        </nav>
      )}

      {/* ── Layout: sidebar nav + main content ─────────────────────── */}
      <div style={{ display: 'flex', gap: 20 }}>
        {/* Desktop sticky side nav */}
        {!isMobile && (
          <nav style={{ width: 170, flexShrink: 0, position: 'sticky', top: 16, alignSelf: 'flex-start', height: 'fit-content', background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', padding: '12px 0' }}>
            {sectionNav.map((s) => (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 16px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#374151', transition: 'background 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#2563eb' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#374151' }}
              >
                {s.label}
              </button>
            ))}
          </nav>
        )}

        {/* ── Main content area ────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* ═══ 1. KEY METRICS (+ Cash Flow merged) ═══════════════ */}
          <Section id="key-metrics" title="Key Metrics" defaultOpen>
            <div style={{ ...rowStyle, alignItems: 'stretch', marginBottom: 12 }}>
              {stat('Revenue', fmtCurrency(revenue))}
              {stat('Expenses', fmtCurrency(expenseTotal))}
              {stat('Depreciation (range)', fmtCurrency(depreciationInRange))}
              {stat('P&L', fmtCurrency(pnl))}
            </div>
            <div style={{ ...rowStyle, alignItems: 'stretch' }}>
              {stat('Inflow (paid revenue)', fmtCurrency(revenue))}
              {stat('Outflow (expenses)', fmtCurrency(expenseTotal))}
              {stat('Net Cash Flow', fmtCurrency(cashFlow))}
              {stat('Unpaid Orders', String(unpaidCount))}
            </div>
          </Section>

          {/* ═══ JUICE TIER TRACKER ════════════════════════════════ */}
          <Section id="juice-tier" title="Juice Bottle Tier Tracker" defaultOpen>
            {/* Month selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <label style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>Month:</label>
              <select
                className="input"
                value={tierMonth}
                onChange={(e) => setTierMonth(e.target.value)}
                style={{ width: 160, padding: '6px 10px', fontSize: 14 }}
              >
                {tierMonthOptions.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Tier visual card */}
            {(() => {
              const { totalBottles, currentTier, progress } = juiceTierData
              const tierColors = ['#94a3b8', '#22c55e', '#3b82f6', '#f59e0b']
              const tierBg = ['linear-gradient(135deg,#f1f5f9,#e2e8f0)', 'linear-gradient(135deg,#f0fdf4,#dcfce7)', 'linear-gradient(135deg,#eff6ff,#dbeafe)', 'linear-gradient(135deg,#fffbeb,#fef3c7)']
              const tierBorderColors = ['#cbd5e1', '#86efac', '#93c5fd', '#fcd34d']
              const filledWidth = currentTier.tier === 3
                ? 100
                : Math.min(100, Math.max(0, ((totalBottles - currentTier.min) / (currentTier.max - currentTier.min + 1)) * 100))
              return (
                <div style={{ background: tierBg[currentTier.tier], borderRadius: 16, padding: 24, border: `2px solid ${tierBorderColors[currentTier.tier]}`, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Current Tier</div>
                      <div style={{ fontSize: 42, fontWeight: 800, color: tierColors[currentTier.tier], lineHeight: 1.1 }}>Tier {currentTier.tier}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#6b7280' }}>Bottles Sold</div>
                      <div style={{ fontSize: 36, fontWeight: 800, color: '#1e293b' }}>{totalBottles.toLocaleString()}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#6b7280' }}>Worker Bonus</div>
                      <div style={{ fontSize: 36, fontWeight: 800, color: currentTier.bonus > 0 ? '#16a34a' : '#94a3b8' }}>{currentTier.label}</div>
                    </div>
                  </div>

                  {/* Status message */}
                  <div style={{ marginTop: 16, fontSize: 16, fontWeight: 600, color: '#334155' }}>
                    {currentTier.msg}
                  </div>

                  {/* Progress bar */}
                  <div style={{ marginTop: 12, background: '#e2e8f0', borderRadius: 8, height: 14, overflow: 'hidden' }}>
                    <div style={{ width: `${filledWidth}%`, height: '100%', background: tierColors[currentTier.tier], borderRadius: 8, transition: 'width 0.5s ease' }} />
                  </div>

                  {/* Next tier messages */}
                  {progress.length > 0 && (
                    <div style={{ marginTop: 14 }}>
                      {progress.map((msg, i) => (
                        <div key={i} style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>→ {msg}</div>
                      ))}
                    </div>
                  )}

                  {/* Tier reference table */}
                  <div style={{ marginTop: 16 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #cbd5e1' }}>
                          <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280' }}>Tier</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280' }}>Bottles Range</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', color: '#6b7280' }}>Bonus</th>
                        </tr>
                      </thead>
                      <tbody>
                        {JUICE_TIERS.map((t) => (
                          <tr key={t.tier} style={{ borderBottom: '1px solid #e2e8f0', background: t.tier === currentTier.tier ? 'rgba(0,0,0,0.04)' : 'transparent', fontWeight: t.tier === currentTier.tier ? 700 : 400 }}>
                            <td style={{ padding: '6px 8px' }}>Tier {t.tier}</td>
                            <td style={{ padding: '6px 8px' }}>{t.max === Infinity ? `${t.min.toLocaleString()}+` : `${t.min.toLocaleString()} – ${t.max.toLocaleString()}`}</td>
                            <td style={{ padding: '6px 8px' }}>{t.label}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })()}
          </Section>

          {/* ═══ 2. EXPENSES ═══════════════════════════════════════ */}
          <Section id="expenses" title="Expenses" defaultOpen>
            <TrendTable title="Expense trend" data={expenseTrend} formatter={fmtCurrency} exportName="expense-trend.xlsx" showGranularityPicker />

            <div style={{ marginTop: 16 }}>
              <BarChart
                title="Expenses by Type"
                data={filteredExpensesByType.map((e, i) => ({
                  id: `expense:${e.type}`,
                  label: e.type,
                  quantity: e.count,
                  amount: e.total,
                  color: ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][i % 5],
                }))}
                mode="amount"
                onBarClick={(id) => {
                  if (!id.startsWith('expense:')) return
                  const type = id.slice('expense:'.length)
                  const rows = expensesInRange
                    .filter((e) => String(e.name || 'Other') === type)
                    .map((e) => ({ id: e.id, date: fmtDate(bestExpenseDate(e)), name: e.name, amount: Number(e.amount || 0), appliesTo: (e.appliesTo || []).join(' | '), narration: e.narration || '' }))
                  setDrilldown({ title: `Expenses — ${type}`, rows })
                }}
              />
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <h4 style={{ margin: 0 }}>Expenses by Type</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="text" className="input" placeholder="Search expense type…" value={expenseSearch} onChange={(e) => setExpenseSearch(e.target.value)} style={{ width: 200 }} />
                  <ExcelBtn onClick={() => exportExcel('expenses-by-type.xlsx', filteredExpensesByType.map((e) => ({ type: e.type, count: e.count, total: Number(e.total || 0).toFixed(2) })))} />
                </div>
              </div>
              <ResponsiveDataGrid
                rows={filteredExpensesByType.map((e) => ({ id: e.type, ...e }))}
                columns={
                  [
                    { field: 'type', headerName: 'Expense Type', flex: 1, minWidth: 200 },
                    { field: 'count', headerName: 'Count', width: 100, valueGetter: (_v: any, row: any) => Number(row.count || 0).toLocaleString() },
                    { field: 'total', headerName: 'Total Amount', width: 150, valueGetter: (_v: any, row: any) => fmtCurrency(Number(row.total || 0)) },
                    {
                      field: 'actions', headerName: 'Actions', width: 120,
                      renderCell: (params: any) => (
                        <button className="btn" onClick={() => {
                          const type = params.row.type
                          const rows = expensesInRange.filter((e) => String(e.name || 'Other') === type).map((e) => ({ id: e.id, date: fmtDate(bestExpenseDate(e)), name: e.name, amount: Number(e.amount || 0), appliesTo: (e.appliesTo || []).join(' | '), narration: e.narration || '' }))
                          setDrilldown({ title: `Expenses — ${type}`, rows })
                        }}>Details</button>
                      ),
                    },
                  ] as GridColDef<any>[]
                }
                cardTitle={(row: any) => row.type}
                cardFields={[
                  { label: 'Count', value: (row: any) => Number(row.count || 0).toLocaleString() },
                  { label: 'Total', value: (row: any) => fmtCurrency(Number(row.total || 0)) },
                ]}
                cardActions={(row: any) => (
                  <button className="btn" onClick={() => {
                    const type = row.type
                    const rows = expensesInRange.filter((e) => String(e.name || 'Other') === type).map((e) => ({ id: e.id, date: fmtDate(bestExpenseDate(e)), name: e.name, amount: Number(e.amount || 0), appliesTo: (e.appliesTo || []).join(' | '), narration: e.narration || '' }))
                    setDrilldown({ title: `Expenses — ${type}`, rows })
                  }}>Details</button>
                )}
                gridHeight={300}
              />
            </div>
          </Section>

          {/* ═══ 3. REVENUE ════════════════════════════════════════ */}
          <Section id="revenue" title="Revenue" defaultOpen>
            <div style={{ ...rowStyle, alignItems: 'stretch', marginBottom: 12 }}>
              {stat('Paid Orders', String(paidOrdersInValueRange.length))}
              {stat('Revenue (Amount Paid)', fmtCurrency(paidRevenueAmount))}
              {stat('Delivery Fees', fmtCurrency(paidDeliveryFeeAmount))}
              {stat('Product Revenue (Net)', fmtCurrency(paidNetRevenueAmount))}
              {stat('Packs Sold', String(totalPacksSold.toLocaleString()))}
              {stat('Units Sold', String(totalUnitsSold.toLocaleString()))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ marginRight: 8 }}>Metric:</label>
                <select className="select" value={salesTrendMetric} onChange={(e) => setSalesTrendMetric(e.target.value as any)}>
                  <option value="revenue">Revenue</option>
                  <option value="units">Units</option>
                  <option value="orders">Orders</option>
                </select>
              </div>
            </div>

            <TrendTable
              title="Sales trend"
              data={salesTrendMetric === 'revenue' ? salesTrend : salesTrendMetric === 'units' ? salesTrendUnits : salesTrendOrders}
              formatter={salesTrendMetric === 'revenue' ? fmtCurrency : (n: number) => (isNaN(n) ? '-' : String(Math.round(n).toLocaleString()))}
              exportName="sales-trend.xlsx"
              showGranularityPicker
            />

            <CumulativeLinesChart title="Cumulative Revenue vs Expense" points={cumulativeCashSeries} />

            {/* Product Sales Summary */}
            <div style={{ marginTop: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <h4 style={{ margin: 0 }}>Product Sales Summary</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <select className="select" value={productTypeFilter} onChange={(e) => setProductTypeFilter(e.target.value as 'all' | 'juice' | 'meal' | 'shot' | 'package')}>
                    <option value="all">All</option>
                    <option value="juice">Juice</option>
                    <option value="meal">Meal</option>
                    <option value="shot">Shot</option>
                    <option value="package">Package</option>
                  </select>
                  <input
                    type="text"
                    className="input"
                    placeholder="Search product…"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    style={{ width: 220 }}
                  />
                  <ExcelBtn onClick={() => exportExcel('product-sales.xlsx', filteredProductsSoldAgg.map((p) => ({
                    product: p.name,
                    type: p.type || '',
                    orders: productOrderCounts[p.productId] || 0,
                    packages: p.packages,
                    count: p.units,
                    amount: Number(p.amount || 0).toFixed(2),
                  })))} />
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ textAlign: 'left', padding: '10px 12px' }}>Product</th>
                      <th style={{ textAlign: 'right', padding: '10px 12px' }}>Orders</th>
                      <th style={{ textAlign: 'right', padding: '10px 12px' }}>Packages</th>
                      <th style={{ textAlign: 'right', padding: '10px 12px' }}>Count</th>
                      <th style={{ textAlign: 'right', padding: '10px 12px' }}>Amount</th>
                      <th style={{ textAlign: 'center', padding: '10px 12px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProductsSoldAgg.slice(0, 12).map((p) => (
                      <tr key={p.productId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '10px 12px' }}>{p.name}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          {productOrderCounts[p.productId] || 0}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.packages.toLocaleString()}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{p.units.toLocaleString()}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{fmtCurrency(Number(p.amount || 0))}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <button className="btn" onClick={() => openProductDrilldown(p.productId)}>Details</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f9fafb', borderTop: '2px solid #e5e7eb' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 800 }}>Totals</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800 }}>
                        {filteredProductOrderTotal}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800 }}>
                        {filteredProductsSoldAgg.reduce((s, p) => s + Number(p.packages || 0), 0).toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800 }}>
                        {filteredProductsSoldAgg.reduce((s, p) => s + Number(p.units || 0), 0).toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800 }}>
                        {fmtCurrency(filteredProductsSoldAgg.reduce((s, p) => s + Number(p.amount || 0), 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>Amount = total units sold × unit cost per product.</p>
            </div>

            {/* Product Posting Report */}
            <div style={{ marginTop: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 12 }}>
                <h4 style={{ margin: 0 }}>Product Posting Report (Paid Orders)</h4>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <label style={{ fontSize: 12, color: '#6b7280' }}>Posting Start</label>
                    <input className="input" type="date" value={postingStartDate} onChange={(e) => setPostingStartDate(e.target.value)} />
                  </div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    <label style={{ fontSize: 12, color: '#6b7280' }}>Posting End</label>
                    <input className="input" type="date" value={postingEndDate} onChange={(e) => setPostingEndDate(e.target.value)} />
                  </div>
                  <div style={{ display: 'grid', gap: 6, minWidth: 170 }}>
                    <label style={{ fontSize: 12, color: '#6b7280' }}>Product Types (multi-select)</label>
                    <select
                      className="select"
                      multiple
                      value={postingProductTypes}
                      onChange={(e) => {
                        const values = Array.from(e.target.selectedOptions).map((opt) => opt.value)
                        setPostingProductTypes(values)
                      }}
                      style={{ minHeight: 110 }}
                    >
                      {postingProductTypeOptions.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gap: 6, minWidth: 220 }}>
                    <label style={{ fontSize: 12, color: '#6b7280' }}>Products (multi-select)</label>
                    <select
                      className="select"
                      multiple
                      value={postingEffectiveProductIds}
                      onChange={(e) => {
                        const values = Array.from(e.target.selectedOptions).map((opt) => opt.value)
                        setPostingProductIds(values)
                      }}
                      style={{ minHeight: 110 }}
                    >
                      {postingProductOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.name}</option>
                      ))}
                    </select>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn" onClick={() => setPostingProductIds(postingProductOptions.map((p) => p.id))}>Select All</button>
                      <button className="btn" onClick={() => setPostingProductIds([])}>Clear</button>
                    </div>
                  </div>
                  <ExcelBtn
                    label="Posting Report"
                    onClick={() => exportExcel('product-posting-report.xlsx', postingProductReportRows.map((r) => ({
                      postingDate: r.postingDate,
                      product: r.product,
                      productType: r.productType,
                      orderCount: r.orderCount,
                      count: r.count,
                      unitCount: r.unitCount,
                    })))}
                  />
                </div>
              </div>

              <ResponsiveDataGrid
                rows={postingProductReportRows}
                columns={[
                  { field: 'postingDate', headerName: 'Posting Date', width: 130 },
                  { field: 'product', headerName: 'Product', flex: 1, minWidth: 180 },
                  { field: 'productType', headerName: 'Type', width: 100 },
                  { field: 'orderCount', headerName: 'Orders', width: 100, valueGetter: (_v: any, row: any) => Number(row.orderCount || 0).toLocaleString() },
                  { field: 'count', headerName: 'Count', width: 110, valueGetter: (_v: any, row: any) => Number(row.count || 0).toLocaleString() },
                  { field: 'unitCount', headerName: 'Unit Count', width: 120, valueGetter: (_v: any, row: any) => Number(row.unitCount || 0).toLocaleString() },
                  {
                    field: 'actions',
                    headerName: 'Actions',
                    width: 110,
                    renderCell: (params: any) => (<button className="btn" type="button" onClick={() => openPostingProductDrilldown(params.row)}>Details</button>),
                  },
                ] as GridColDef<any>[]}
                cardTitle={(row: any) => `${row.product} (${row.postingDate})`}
                cardFields={[
                  { label: 'Type', value: (row: any) => row.productType || '-' },
                  { label: 'Orders', value: (row: any) => Number(row.orderCount || 0).toLocaleString() },
                  { label: 'Count', value: (row: any) => Number(row.count || 0).toLocaleString() },
                  { label: 'Unit Count', value: (row: any) => Number(row.unitCount || 0).toLocaleString() },
                ]}
                cardActions={(row: any) => (<button className="btn" type="button" onClick={() => openPostingProductDrilldown(row)}>Details</button>)}
                gridHeight={360}
              />

              <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#f8fafc', fontSize: 12 }}>
                  Rows: <strong>{postingReportSummary.rows.toLocaleString()}</strong>
                </div>
                <div style={{ padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#f8fafc', fontSize: 12 }}>
                  Orders (summed): <strong>{postingReportSummary.orders.toLocaleString()}</strong>
                </div>
                <div style={{ padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#f8fafc', fontSize: 12 }}>
                  Count: <strong>{postingReportSummary.count.toLocaleString()}</strong>
                </div>
                <div style={{ padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 10, background: '#f8fafc', fontSize: 12 }}>
                  Unit Count: <strong>{postingReportSummary.unitCount.toLocaleString()}</strong>
                </div>
              </div>
            </div>

            {/* Sales by Product Chart */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <h4 style={{ margin: 0 }}>Sales by Product Chart</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <label style={{ fontSize: 14, fontWeight: 500 }}>Show:</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={chartViewMode === 'amount' || chartViewMode === 'both'} onChange={(e) => {
                      if (e.target.checked) { setChartViewMode(chartViewMode === 'quantity' ? 'both' : 'amount') } else { setChartViewMode(chartViewMode === 'both' ? 'quantity' : 'none') }
                    }} /> Amount
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={chartViewMode === 'quantity' || chartViewMode === 'both'} onChange={(e) => {
                      if (e.target.checked) { setChartViewMode(chartViewMode === 'amount' ? 'both' : 'quantity') } else { setChartViewMode(chartViewMode === 'both' ? 'amount' : 'none') }
                    }} /> Quantity
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={chartViewMode === 'orders' || chartViewMode === 'all'} onChange={(e) => {
                      if (e.target.checked) { setChartViewMode((chartViewMode === 'amount' || chartViewMode === 'quantity' || chartViewMode === 'both') ? 'all' : 'orders') } else { setChartViewMode(chartViewMode === 'all' ? 'both' : 'none') }
                    }} /> Orders
                  </label>
                </div>
              </div>
              <BarChart title="" data={barData} mode={chartViewMode} onBarClick={openProductDrilldown} />
            </div>
          </Section>

          {/* ═══ 4. DELIVERY RIDERS ════════════════════════════════ */}
          <Section id="riders" title="Delivery Riders" defaultOpen>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <h4 style={{ margin: 0 }}>Delivery Fees by Rider</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="text" className="input" placeholder="Search rider…" value={riderSearch} onChange={(e) => setRiderSearch(e.target.value)} style={{ width: 200 }} />
                <ExcelBtn onClick={() => exportExcel('rider-fees.xlsx', filteredRiders.map((r) => ({ rider: r.rider, totalDeliveryFees: Number(r.total || 0).toFixed(2) })))} />
              </div>
            </div>
            <ResponsiveDataGrid
              rows={filteredRiders.map((r) => ({ id: r.rider, ...r }))}
              columns={
                [
                  { field: 'rider', headerName: 'Rider', flex: 1, minWidth: 220 },
                  { field: 'total', headerName: 'Total Delivery Fees', width: 200, valueGetter: (_v: any, row: any) => fmtCurrency(Number(row.total || 0)) },
                  {
                    field: 'actions', headerName: 'Actions', width: 120,
                    renderCell: (params: any) => {
                      if (params.row.rider === 'TOTAL') return null
                      return (
                        <button className="btn" onClick={() => {
                          const rider = params.row.rider
                          const rows = paidOrdersInValueRange
                            .filter((o) => String(o.deliveredBy || '') === rider)
                            .map((o) => {
                              const c = customers.find((cc) => cc.id === o.customerId) || null
                              return { orderId: o.id, customerName: c?.name || 'Unknown', location: [c?.deliveryAddress1, c?.deliveryAddress2, c?.city].filter(Boolean).join(', '), telephone: [c?.telephone1, c?.telephone2].filter(Boolean).join(' / '), amountPaid: Number(o.amountPaid || 0), deliveryAmount: Number(o.deliveryFee || 0) }
                            })
                          setDrilldown({ title: `Rider Details — ${rider}`, rows })
                        }}>Details</button>
                      )
                    },
                  },
                ] as GridColDef<any>[]
              }
              cardTitle={(row: any) => row.rider}
              cardFields={[{ label: 'Total', value: (row: any) => fmtCurrency(Number(row.total || 0)) }]}
              cardActions={(row: any) => {
                if (row.rider === 'TOTAL') return null
                return (
                  <button className="btn" onClick={() => {
                    const rider = row.rider
                    const rows = paidOrdersInValueRange
                      .filter((o) => String(o.deliveredBy || '') === rider)
                      .map((o) => {
                        const c = customers.find((cc) => cc.id === o.customerId) || null
                        return { orderId: o.id, customerName: c?.name || 'Unknown', location: [c?.deliveryAddress1, c?.deliveryAddress2, c?.city].filter(Boolean).join(', '), telephone: [c?.telephone1, c?.telephone2].filter(Boolean).join(' / '), amountPaid: Number(o.amountPaid || 0), deliveryAmount: Number(o.deliveryFee || 0) }
                      })
                    setDrilldown({ title: `Rider Details — ${rider}`, rows })
                  }}>Details</button>
                )
              }}
              gridHeight={360}
            />

            <div style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                <h4 style={{ margin: 0 }}>Rider Delivery Report</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ fontSize: 12, color: '#6b7280' }}>Group by</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={riderReportFields.location}
                      onChange={(e) => setRiderReportFields({ ...riderReportFields, location: e.target.checked })}
                    />
                    Location
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={riderReportFields.date}
                      onChange={(e) => setRiderReportFields({ ...riderReportFields, date: e.target.checked })}
                    />
                    Date
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={riderReportFields.rider}
                      onChange={(e) => setRiderReportFields({ ...riderReportFields, rider: e.target.checked })}
                    />
                    Rider
                  </label>
                  <ExcelBtn onClick={() => exportExcel('rider-delivery-report.xlsx', riderDeliveryExportRows)} />
                  <ExcelBtn onClick={() => exportExcel('rider-delivery-report-all.xlsx', riderDeliveryExportAllRows)} label="All" />
                </div>
              </div>

              {!selectedGroupFields.length ? (
                <p style={{ fontSize: 12, color: '#6b7280' }}>Select at least one grouping option to show the report.</p>
              ) : !riderDeliveryGroups.length ? (
                <p style={{ fontSize: 12, color: '#6b7280' }}>No delivered orders found in this range.</p>
              ) : (
                <>
                  {renderGroupNodes(riderDeliveryGroups)}
                  <div style={{ textAlign: 'right', fontSize: 12, color: '#6b7280' }}>
                    Grand total delivery fees: {fmtCurrency(Number(riderDeliveryGrandTotal || 0))}
                  </div>
                </>
              )}
            </div>
          </Section>

          {/* ═══ 5. PROFIT & LOSS ═════════════════════════════════ */}
          <Section id="pnl" title="Profit & Loss" defaultOpen>
            <TrendTable title="P&L trend" data={pnlTrend.map((p) => ({ ...p, items: [] }))} formatter={fmtCurrency} exportName="pnl-trend.xlsx" showGranularityPicker />
            <p style={{ fontSize: 12, color: '#6b7280' }}>P&L trend reflects revenue minus expenses, with depreciation allocated into the selected daily, weekly, monthly, or yearly buckets.</p>
          </Section>

          {/* ═══ 6. TOP CUSTOMERS ═════════════════════════════════ */}
          <Section id="top-customers" title="Top Customers" defaultOpen>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <h4 style={{ margin: 0 }}>Top 10 Customers ({viewMode})</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="text" className="input" placeholder="Search customer…" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} style={{ width: 200 }} />
                <ExcelBtn onClick={() => exportExcel('top-customers.xlsx', filteredTopCustomers.map((c) => ({ name: c.name, revenue: Number(c.revenue || 0).toFixed(2), units: c.volume })))} />
              </div>
            </div>
            <ResponsiveDataGrid
              rows={filteredTopCustomers}
              columns={
                [
                  { field: 'name', headerName: 'Customer', flex: 1, minWidth: 220 },
                  { field: 'metric', headerName: viewMode === 'revenue' ? 'Revenue' : 'Units', width: 140, valueGetter: (_v: any, row: any) => viewMode === 'revenue' ? fmtCurrency(Number(row.revenue || 0)) : String(row.volume ?? 0) },
                ] as GridColDef<any>[]
              }
              cardTitle={(row: any) => row.name}
              cardFields={[{ label: viewMode === 'revenue' ? 'Revenue' : 'Units', value: (row: any) => viewMode === 'revenue' ? fmtCurrency(Number(row.revenue || 0)) : String(row.volume ?? 0) }]}
              gridHeight={360}
            />

            {/* Lapsed Customers */}
            {lapsedCustomers.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                  <h4 style={{ margin: 0 }}>Lapsed Customers ({lapsedCustomers.length})</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="text" className="input" placeholder="Search customer…" value={lapsedSearch} onChange={(e) => setLapsedSearch(e.target.value)} style={{ width: 200 }} />
                    <ExcelBtn onClick={() => exportExcel('lapsed-customers.xlsx', filteredLapsed.map((c) => ({ name: c.name, lastOrder: fmtDate(c.lastOrder) })))} />
                  </div>
                </div>
                <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>Customers who ordered before the selected range but have no orders during it.</p>
                <ResponsiveDataGrid
                  rows={filteredLapsed}
                  columns={
                    [
                      { field: 'name', headerName: 'Customer', flex: 1, minWidth: 220 },
                      { field: 'lastOrder', headerName: 'Last Order', width: 160, valueGetter: (_v: any, row: any) => fmtDate(row.lastOrder) },
                    ] as GridColDef<any>[]
                  }
                  cardTitle={(row: any) => row.name}
                  cardFields={[{ label: 'Last Order', value: (row: any) => fmtDate(row.lastOrder) }]}
                  gridHeight={300}
                />
              </div>
            )}
          </Section>

          {/* ═══ 7. CUSTOMER CATEGORIES ═══════════════════════════ */}
          <Section id="customer-categories" title="Customer Categories" defaultOpen>
            <div style={{ ...rowStyle, alignItems: 'stretch', marginBottom: 12 }}>
              {stat('Category Types', String(customerCategoriesAgg.length))}
              {stat('Customers Tagged', String(new Set(customerCategoriesAgg.flatMap((r) => (r.customers || []).map((c: any) => c.id))).size))}
              {stat('Paid Txn Volume', String(categoryTransactionAgg.reduce((s, r) => s + Number(r.transactionVolume || 0), 0).toLocaleString()))}
              {stat('Paid Txn Value', fmtCurrency(categoryTransactionAgg.reduce((s, r) => s + Number(r.transactionValue || 0), 0)))}
            </div>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 16 }}>
              {customerCategoriesAgg.map((row) => (
                <button
                  key={row.code}
                  type="button"
                  className="btn"
                  style={{ textAlign: 'left', padding: 12 }}
                  onClick={() => {
                    const drillRows = (row.customers || []).map((c: any) => {
                      const customerOrders = paidOrdersInValueRange.filter((o) => String(o.customerId || '') === String(c.id || ''))
                      return {
                        customerName: c.name || c.id,
                        phone: [c.telephone1, c.telephone2, c.telephone, c.phone].filter(Boolean).join(' / ') || '-',
                        location: [c.deliveryAddress1, c.deliveryAddress2, c.city].filter(Boolean).join(', ') || '-',
                        categories: (c.categoryCodes || []).map((code: string) => categoryLabelMap[String(code)] || code).join(', ') || '-',
                        allergies: (c.allergyCodes || []).map((code: string) => allergyLabelMap[String(code)] || code).join(', ') || '-',
                        transactionVolume: customerOrders.length,
                        transactionValue: customerOrders.reduce((s, o) => s + Number(o.amountPaid || 0), 0),
                      }
                    })
                    setDrilldown({ title: `Category Details — ${row.label}`, rows: drillRows })
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#111827' }}>{row.label}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{row.customerCount} customers</div>
                </button>
              ))}
            </div>

            <ResponsiveDataGrid
              rows={categoryTransactionAgg.map((r) => ({ id: r.code, ...r }))}
              columns={[
                { field: 'label', headerName: 'Category', flex: 1, minWidth: 220 },
                { field: 'customerCount', headerName: 'Customers', width: 120 },
                { field: 'transactionVolume', headerName: 'Txn Volume', width: 130 },
                { field: 'transactionValue', headerName: 'Txn Value', width: 150, valueGetter: (_v: any, row: any) => fmtCurrency(Number(row.transactionValue || 0)) },
                {
                  field: 'actions',
                  headerName: 'Actions',
                  width: 120,
                  sortable: false,
                  filterable: false,
                  renderCell: (params: any) => {
                    const categoryCode = String(params.row.code)
                    const rows = customers
                      .filter((c) => Array.isArray(c.categoryCodes) && c.categoryCodes.map((x: any) => String(x)).includes(categoryCode))
                      .map((c) => {
                        const customerOrders = paidOrdersInValueRange.filter((o) => String(o.customerId || '') === String(c.id || ''))
                        return {
                          customerName: c.name || c.id,
                          phone: [c.telephone1, c.telephone2, c.telephone, c.phone].filter(Boolean).join(' / ') || '-',
                          location: [c.deliveryAddress1, c.deliveryAddress2, c.city].filter(Boolean).join(', ') || '-',
                          categories: (c.categoryCodes || []).map((code: string) => categoryLabelMap[String(code)] || code).join(', ') || '-',
                          allergies: (c.allergyCodes || []).map((code: string) => allergyLabelMap[String(code)] || code).join(', ') || '-',
                          transactionVolume: customerOrders.length,
                          transactionValue: customerOrders.reduce((s, o) => s + Number(o.amountPaid || 0), 0),
                        }
                      })
                    return <button className="btn" onClick={() => setDrilldown({ title: `Category Details — ${params.row.label}`, rows })}>Details</button>
                  },
                },
              ] as GridColDef<any>[]}
              cardTitle={(row: any) => row.label}
              cardFields={[
                { label: 'Customers', value: (row: any) => String(row.customerCount || 0) },
                { label: 'Txn Volume', value: (row: any) => String(row.transactionVolume || 0) },
                { label: 'Txn Value', value: (row: any) => fmtCurrency(Number(row.transactionValue || 0)) },
              ]}
              cardActions={(row: any) => {
                const categoryCode = String(row.code)
                const rows = customers
                  .filter((c) => Array.isArray(c.categoryCodes) && c.categoryCodes.map((x: any) => String(x)).includes(categoryCode))
                  .map((c) => {
                    const customerOrders = paidOrdersInValueRange.filter((o) => String(o.customerId || '') === String(c.id || ''))
                    return {
                      customerName: c.name || c.id,
                      phone: [c.telephone1, c.telephone2, c.telephone, c.phone].filter(Boolean).join(' / ') || '-',
                      location: [c.deliveryAddress1, c.deliveryAddress2, c.city].filter(Boolean).join(', ') || '-',
                      categories: (c.categoryCodes || []).map((code: string) => categoryLabelMap[String(code)] || code).join(', ') || '-',
                      allergies: (c.allergyCodes || []).map((code: string) => allergyLabelMap[String(code)] || code).join(', ') || '-',
                      transactionVolume: customerOrders.length,
                      transactionValue: customerOrders.reduce((s, o) => s + Number(o.amountPaid || 0), 0),
                    }
                  })
                return <button className="btn" onClick={() => setDrilldown({ title: `Category Details — ${row.label}`, rows })}>Details</button>
              }}
              gridHeight={360}
            />
          </Section>

          {/* ═══ 8. CUSTOMER ALLERGIES ════════════════════════════ */}
          <Section id="customer-allergies" title="Customer Allergies" defaultOpen>
            <div style={{ ...rowStyle, alignItems: 'stretch', marginBottom: 12 }}>
              {stat('Allergy Types', String(customerAllergiesAgg.length))}
              {stat('Customers Tagged', String(new Set(customerAllergiesAgg.flatMap((r) => (r.customers || []).map((c: any) => c.id))).size))}
            </div>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 16 }}>
              {customerAllergiesAgg.map((row) => (
                <button
                  key={row.code}
                  type="button"
                  className="btn"
                  style={{ textAlign: 'left', padding: 12 }}
                  onClick={() => {
                    const drillRows = (row.customers || []).map((c: any) => {
                      const customerOrders = paidOrdersInValueRange.filter((o) => String(o.customerId || '') === String(c.id || ''))
                      return {
                        customerName: c.name || c.id,
                        phone: [c.telephone1, c.telephone2, c.telephone, c.phone].filter(Boolean).join(' / ') || '-',
                        location: [c.deliveryAddress1, c.deliveryAddress2, c.city].filter(Boolean).join(', ') || '-',
                        categories: (c.categoryCodes || []).map((code: string) => categoryLabelMap[String(code)] || code).join(', ') || '-',
                        allergies: (c.allergyCodes || []).map((code: string) => allergyLabelMap[String(code)] || code).join(', ') || '-',
                        transactionVolume: customerOrders.length,
                        transactionValue: customerOrders.reduce((s, o) => s + Number(o.amountPaid || 0), 0),
                      }
                    })
                    setDrilldown({ title: `Allergy Details — ${row.label}`, rows: drillRows })
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#111827' }}>{row.label}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{row.customerCount} customers</div>
                </button>
              ))}
            </div>

            <ResponsiveDataGrid
              rows={customerAllergiesAgg.map((r) => ({ id: r.code, ...r }))}
              columns={[
                { field: 'label', headerName: 'Allergy', flex: 1, minWidth: 220 },
                { field: 'customerCount', headerName: 'Customers', width: 120 },
                {
                  field: 'actions',
                  headerName: 'Actions',
                  width: 120,
                  sortable: false,
                  filterable: false,
                  renderCell: (params: any) => {
                    const allergyCode = String(params.row.code)
                    const rows = customers
                      .filter((c) => Array.isArray(c.allergyCodes) && c.allergyCodes.map((x: any) => String(x)).includes(allergyCode))
                      .map((c) => {
                        const customerOrders = paidOrdersInValueRange.filter((o) => String(o.customerId || '') === String(c.id || ''))
                        return {
                          customerName: c.name || c.id,
                          phone: [c.telephone1, c.telephone2, c.telephone, c.phone].filter(Boolean).join(' / ') || '-',
                          location: [c.deliveryAddress1, c.deliveryAddress2, c.city].filter(Boolean).join(', ') || '-',
                          categories: (c.categoryCodes || []).map((code: string) => categoryLabelMap[String(code)] || code).join(', ') || '-',
                          allergies: (c.allergyCodes || []).map((code: string) => allergyLabelMap[String(code)] || code).join(', ') || '-',
                          transactionVolume: customerOrders.length,
                          transactionValue: customerOrders.reduce((s, o) => s + Number(o.amountPaid || 0), 0),
                        }
                      })
                    return <button className="btn" onClick={() => setDrilldown({ title: `Allergy Details — ${params.row.label}`, rows })}>Details</button>
                  },
                },
              ] as GridColDef<any>[]}
              cardTitle={(row: any) => row.label}
              cardFields={[{ label: 'Customers', value: (row: any) => String(row.customerCount || 0) }]}
              cardActions={(row: any) => {
                const allergyCode = String(row.code)
                const rows = customers
                  .filter((c) => Array.isArray(c.allergyCodes) && c.allergyCodes.map((x: any) => String(x)).includes(allergyCode))
                  .map((c) => {
                    const customerOrders = paidOrdersInValueRange.filter((o) => String(o.customerId || '') === String(c.id || ''))
                    return {
                      customerName: c.name || c.id,
                      phone: [c.telephone1, c.telephone2, c.telephone, c.phone].filter(Boolean).join(' / ') || '-',
                      location: [c.deliveryAddress1, c.deliveryAddress2, c.city].filter(Boolean).join(', ') || '-',
                      categories: (c.categoryCodes || []).map((code: string) => categoryLabelMap[String(code)] || code).join(', ') || '-',
                      allergies: (c.allergyCodes || []).map((code: string) => allergyLabelMap[String(code)] || code).join(', ') || '-',
                      transactionVolume: customerOrders.length,
                      transactionValue: customerOrders.reduce((s, o) => s + Number(o.amountPaid || 0), 0),
                    }
                  })
                return <button className="btn" onClick={() => setDrilldown({ title: `Allergy Details — ${row.label}`, rows })}>Details</button>
              }}
              gridHeight={320}
            />
          </Section>

          {/* ═══ 9. RECENT PAYMENTS ═══════════════════════════════ */}
          <Section id="recent-payments" title="Recent Payments" defaultOpen>
            {recentPayments.length ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                  <h4 style={{ margin: 0 }}>Recent Payments</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="text" className="input" placeholder="Search customer or order…" value={paymentSearch} onChange={(e) => setPaymentSearch(e.target.value)} style={{ width: 220 }} />
                    <ExcelBtn onClick={() => exportExcel('recent-payments.xlsx', filteredPayments.map((p) => ({
                      date: fmtDate(toDate(p.createdAt) || toDate(p.valueDate)),
                      orderId: p.orderId || '-',
                      customer: customerLabel(p.customerId),
                      amount: Number(p.amount || 0).toFixed(2),
                    })))} />
                  </div>
                </div>
                <ResponsiveDataGrid
                  rows={filteredPayments.map((p) => ({ id: p.id, ...p }))}
                  columns={
                    [
                      { field: 'date', headerName: 'Date', width: 130, valueGetter: (_v: any, row: any) => fmtDate(toDate(row.createdAt) || toDate(row.valueDate)) },
                      { field: 'orderId', headerName: 'Order', width: 220, valueGetter: (_v: any, row: any) => row.orderId || '-' },
                      { field: 'customer', headerName: 'Customer', flex: 1, minWidth: 220, valueGetter: (_v: any, row: any) => customerLabel(row.customerId) },
                      { field: 'amount', headerName: 'Amount', width: 130, valueGetter: (_v: any, row: any) => fmtCurrency(Number(row.amount || 0)) },
                    ] as GridColDef<any>[]
                  }
                  cardTitle={(row: any) => `Order ${row.orderId || '-'}`}
                  cardFields={[
                    { label: 'Date', value: (row: any) => fmtDate(toDate(row.createdAt) || toDate(row.valueDate)) },
                    { label: 'Customer', value: (row: any) => customerLabel(row.customerId) },
                    { label: 'Amount', value: (row: any) => fmtCurrency(Number(row.amount || 0)) },
                  ]}
                  gridHeight={320}
                />
              </>
            ) : (
              <p style={{ fontSize: 13, color: '#6b7280' }}>No recent payments</p>
            )}
          </Section>

          {/* ═══ 10. LOCATION ANALYSIS ═══════════════════════════ */}
          <Section id="location" title="Location Analysis" defaultOpen={false}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio" name="locSize" checked={locationMode === 'customers'} onChange={() => setLocationMode('customers')} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Size by: Customers</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio" name="locSize" checked={locationMode === 'orders'} onChange={() => setLocationMode('orders')} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Orders</span>
                  </label>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginLeft: 12 }}>
                  <input type="checkbox" checked={includeUnpaid} onChange={(e) => setIncludeUnpaid(e.target.checked)} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Include unpaid</span>
                </label>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <LocationBubbles
                bubbles={locationAggregates}
                metricMode={locationMode}
                onBubbleClick={(key, label) => {
                  const location = locationAggregates.find((l: any) => l.key === key)
                  if (!location) return
                  setDrilldown({ title: `Location: ${label}`, rows: location.customers || [] })
                }}
              />
            </div>
          </Section>

          {/* ═══ 11. AVERAGE ORDER VALUE (AOV) TREND ═════════════ */}
          <Section id="aov" title="Average Order Value (AOV)" defaultOpen>
            <TrendTable title="AOV trend (monthly)" data={aovTrend} formatter={fmtCurrency} exportName="aov-trend.xlsx" />
            <p style={{ fontSize: 12, color: '#6b7280' }}>AOV = Total Revenue ÷ Number of Orders per month.</p>
          </Section>

          {/* ═══ 12. CUSTOMER RETENTION ═══════════════════════════ */}
          <Section id="retention" title="Customer Retention" defaultOpen>
            <div style={{ ...rowStyle, alignItems: 'stretch', marginBottom: 16 }}>
              {stat('Total Customers', String(customerRetention.total))}
              {stat('New (1 order)', String(customerRetention.newCount))}
              {stat('Repeat (>1 order)', String(customerRetention.repeatCount))}
              {stat('Repeat Rate', `${customerRetention.repeatRate.toFixed(1)}%`)}
            </div>

            {customerRetention.repeatCustomers.length > 0 && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
                  <h4 style={{ margin: 0 }}>Repeat Customers</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="text" className="input" placeholder="Search customer…" value={repeatSearch} onChange={(e) => setRepeatSearch(e.target.value)} style={{ width: 200 }} />
                    <ExcelBtn onClick={() => exportExcel('repeat-customers.xlsx', filteredRepeatCustomers.map((c) => ({ name: c.name, orders: c.orders, revenue: Number(c.revenue || 0).toFixed(2) })))} />
                  </div>
                </div>
                <ResponsiveDataGrid
                  rows={filteredRepeatCustomers}
                  columns={
                    [
                      { field: 'name', headerName: 'Customer', flex: 1, minWidth: 220 },
                      { field: 'orders', headerName: 'Orders', width: 100 },
                      { field: 'revenue', headerName: 'Revenue', width: 160, valueGetter: (_v: any, row: any) => fmtCurrency(Number(row.revenue || 0)) },
                    ] as GridColDef<any>[]
                  }
                  cardTitle={(row: any) => row.name}
                  cardFields={[
                    { label: 'Orders', value: (row: any) => String(row.orders) },
                    { label: 'Revenue', value: (row: any) => fmtCurrency(Number(row.revenue || 0)) },
                  ]}
                  gridHeight={360}
                />
              </>
            )}
          </Section>

        </div>{/* end main content */}
      </div>{/* end flex layout */}

      <Drilldown />
    </div>
  )
}
