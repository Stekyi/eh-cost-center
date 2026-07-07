import React, { useEffect, useMemo, useRef, useState } from 'react'
import { listDocs } from '../utils/dataClient'
import { toJsDate } from '../utils/dates'
import { toLabelsText } from '../utils/customerSegments'
import { downloadInvoicePdf } from '../utils/pdf'

function fmtDate(val: any) {
  const d = toJsDate(val)
  return d ? d.toISOString().split('T')[0] : '-'
}

export default function OrdersReport() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const reportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [ordersArr, customersArr, productsArr, categoriesArr, allergiesArr] = await Promise.all([
          listDocs('orders'),
          listDocs('customers'),
          listDocs('products'),
          listDocs('customerCategories'),
          listDocs('customerAllergies'),
        ])

        const customersById: Record<string, any> = {}
        customersArr.forEach((d) => {
          customersById[d.id] = d
        })

        const productsById: Record<string, any> = {}
        productsArr.forEach((d) => {
          productsById[d.id] = d
        })

        const categoryLabelMap: Record<string, string> = {}
        categoriesArr.forEach((data) => {
          categoryLabelMap[String(data.code || '')] = String(data.label || data.code || '')
        })

        const allergyLabelMap: Record<string, string> = {}
        allergiesArr.forEach((data) => {
          allergyLabelMap[String(data.code || '')] = String(data.label || data.code || '')
        })

        const items: any[] = []
        ordersArr.forEach((order) => {
          if (order.delivered) return

          const customer = customersById[String(order.customerId || '')] || null
          const itemSummary = (order.items || [])
            .map((it: any) => {
              const p = productsById[String(it.productId || '')] || null
              const productName = String(p?.name || it.productId || 'Unknown Product')
              const qty = Number(it.qtyPackages ?? it.qty ?? 0)
              return `${productName} x${qty}`
            })
            .join('; ')

          items.push({
            id: order.id,
            orderId: order.id,
            orderDate: fmtDate(order.createdAt),
            customerName: String(customer?.name || order.customerId || '-'),
            categories: toLabelsText(customer?.categoryCodes, categoryLabelMap),
            allergies: toLabelsText(customer?.allergyCodes, allergyLabelMap),
            products: itemSummary || '-',
            instructions: String(order.customerInstructions || '-'),
            paidStatus: order.paid ? 'Paid' : 'Not Paid',
          })
        })

        items.sort((a, b) => String(b.orderDate).localeCompare(String(a.orderDate)))
        setRows(items)
      } catch (err) {
        console.error('OrdersReport: load failed', err)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const paidCount = useMemo(() => rows.filter((r) => r.paidStatus === 'Paid').length, [rows])
  const notPaidCount = useMemo(() => rows.filter((r) => r.paidStatus !== 'Paid').length, [rows])

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>Orders Report</h2>
            <div style={{ fontSize: 13, color: 'var(--text-light)' }}>All undelivered orders with paid/not paid indicator</div>
          </div>
          <button
            className="btn btn-primary"
            type="button"
            onClick={async () => {
              if (!reportRef.current) return
              await downloadInvoicePdf(reportRef.current, `orders-report-${new Date().toISOString().slice(0, 10)}.pdf`)
            }}
            disabled={loading || rows.length === 0}
          >
            Generate PDF
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div><strong>Total Undelivered:</strong> {rows.length}</div>
          <div><strong>Paid:</strong> {paidCount}</div>
          <div><strong>Not Paid:</strong> {notPaidCount}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 0 }} ref={reportRef}>
        <h3 style={{ marginBottom: 12 }}>Undelivered Orders</h3>
        {loading ? (
          <div>Loading report...</div>
        ) : rows.length === 0 ? (
          <div>No undelivered orders found.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Categories</th>
                  <th>Allergies</th>
                  <th style={{ minWidth: 320 }}>Products & Qty</th>
                  <th>Instructions</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.orderDate}</td>
                    <td>{row.customerName}</td>
                    <td>{row.categories}</td>
                    <td>{row.allergies}</td>
                    <td style={{ minWidth: 320 }}>{row.products}</td>
                    <td>{row.instructions}</td>
                    <td>
                      <span
                        style={{
                          padding: '4px 8px',
                          borderRadius: 8,
                          fontWeight: 600,
                          fontSize: 12,
                          background: row.paidStatus === 'Paid' ? 'var(--success-light)' : 'var(--warning-light)',
                          color: row.paidStatus === 'Paid' ? '#065f46' : '#92400e',
                        }}
                      >
                        {row.paidStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
