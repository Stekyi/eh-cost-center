import React, { useEffect, useState, useMemo } from 'react';
import { createDoc, updateDocById } from '../utils/dataClient';
import { useLiveCollection } from '../hooks/useLiveCollection';
import { toJsDate } from '../utils/dates';
import { Box } from '@mui/material';
import '../styles.css';

interface Customer {
  id: string;
  name: string;
  telephone1?: string;
}

interface Order {
  id: string;
  customerId: string;
  orderTotal?: number;
  total?: number;
  createdAt?: any;
  delivered?: boolean;
  paid?: boolean;
}

interface TopCustomerDoc {
  id: string;
  customerId: string;
  category: 'volume' | 'loyalty';
  month: string;
  active: boolean;
}

export default function TopCustomers() {
  const [saving, setSaving] = useState(false);

  // Current month string
  const currentMonth = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  // Start of current month (dates are ISO strings on the Neon layer)
  const startOfMonth = useMemo(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Selected top customer IDs
  const [volumeSelections, setVolumeSelections] = useState<string[]>([]);
  const [loyaltySelections, setLoyaltySelections] = useState<string[]>([]);

  const { docs: customers } = useLiveCollection('customers') as unknown as { docs: Customer[] };
  const { docs: orders } = useLiveCollection('orders', {
    where: [{ field: 'createdAt', op: '>=', value: startOfMonth.toISOString() }],
  }) as unknown as { docs: Order[] };
  const { docs: topCustomerDocs, refresh: refreshTop } = useLiveCollection('top_customers', {
    where: [{ field: 'month', op: '==', value: currentMonth }],
  }) as unknown as { docs: TopCustomerDoc[]; refresh: () => void };

  // Initialize selections from existing docs (was done in the top_customers snapshot)
  useEffect(() => {
    setVolumeSelections(topCustomerDocs.filter((t) => t.category === 'volume' && t.active).map((t) => t.customerId));
    setLoyaltySelections(topCustomerDocs.filter((t) => t.category === 'loyalty' && t.active).map((t) => t.customerId));
  }, [topCustomerDocs]);

  // Compute stats per customer
  const customerStats = useMemo(() => {
    const stats: Record<string, { totalSpend: number; orderCount: number; weeksActive: Set<string> }> = {};

    for (const order of orders) {
      if (!order.customerId) continue;
      if (!stats[order.customerId]) {
        stats[order.customerId] = { totalSpend: 0, orderCount: 0, weeksActive: new Set() };
      }
      const s = stats[order.customerId];
      s.totalSpend += Number(order.orderTotal || order.total || 0);
      s.orderCount++;

      // Determine week number from createdAt
      const d = toJsDate(order.createdAt);
      if (d) {
        const weekNum = getWeekNumber(d);
        s.weeksActive.add(`${d.getFullYear()}-W${weekNum}`);
      }
    }

    // Build ranked list
    const ranked = customers
      .map((c) => ({
        ...c,
        totalSpend: stats[c.id]?.totalSpend || 0,
        orderCount: stats[c.id]?.orderCount || 0,
        weeksActive: stats[c.id]?.weeksActive?.size || 0,
      }))
      .filter((c) => c.orderCount > 0);

    return {
      byVolume: [...ranked].sort((a, b) => b.totalSpend - a.totalSpend),
      byLoyalty: [...ranked].sort((a, b) => b.weeksActive - a.weeksActive || b.orderCount - a.orderCount),
    };
  }, [customers, orders]);

  function getWeekNumber(d: Date): number {
    const onejan = new Date(d.getFullYear(), 0, 1);
    const daysSinceJan1 = Math.floor((d.getTime() - onejan.getTime()) / 86400000);
    return Math.ceil((daysSinceJan1 + onejan.getDay() + 1) / 7);
  }

  function toggleSelection(customerId: string, list: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) {
    if (list.includes(customerId)) {
      setter(list.filter((id) => id !== customerId));
    } else {
      if (list.length >= 3) {
        alert('You can select up to 3 customers.');
        return;
      }
      setter([...list, customerId]);
    }
  }

  async function saveSelections() {
    setSaving(true);
    try {
      // Deactivate all existing docs for this month
      for (const doc_ of topCustomerDocs) {
        await updateDocById('top_customers', doc_.id, { active: false });
      }

      // Create new docs for volume selections (Worker stamps createdAt/createdBy)
      for (const customerId of volumeSelections) {
        await createDoc('top_customers', {
          customerId,
          category: 'volume',
          month: currentMonth,
          active: true,
        });
      }

      // Create new docs for loyalty selections
      for (const customerId of loyaltySelections) {
        await createDoc('top_customers', {
          customerId,
          category: 'loyalty',
          month: currentMonth,
          active: true,
        });
      }

      alert('Top customers saved!');
      refreshTop();
    } catch (err: any) {
      console.error('saveSelections error', err);
      alert(err?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  const formatCurrency = (n: number) => `GHS ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="page-container">
      <div className="header">
        <h1>Top Customers — {currentMonth}</h1>
        <button className="btn btn-primary" onClick={saveSelections} disabled={saving}>
          {saving ? 'Saving...' : 'Save Selections'}
        </button>
      </div>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
        {/* Volume (Highest Spend) */}
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Top Volume (Highest Spend)</h2>
          <p style={{ color: '#666', fontSize: 14, marginBottom: 12 }}>
            Select up to 3 customers. Selected: {volumeSelections.length}/3
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: 8 }}>Select</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Customer</th>
                <th style={{ textAlign: 'right', padding: 8 }}>Total Spend</th>
                <th style={{ textAlign: 'right', padding: 8 }}>Orders</th>
              </tr>
            </thead>
            <tbody>
              {customerStats.byVolume.slice(0, 20).map((c, i) => (
                <tr
                  key={c.id}
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    background: volumeSelections.includes(c.id) ? '#e8f5e9' : i < 3 ? '#fffde7' : undefined,
                  }}
                >
                  <td style={{ padding: 8 }}>
                    <input
                      type="checkbox"
                      checked={volumeSelections.includes(c.id)}
                      onChange={() => toggleSelection(c.id, volumeSelections, setVolumeSelections)}
                    />
                  </td>
                  <td style={{ padding: 8 }}>{c.name}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{formatCurrency(c.totalSpend)}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{c.orderCount}</td>
                </tr>
              ))}
              {customerStats.byVolume.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 16, textAlign: 'center', color: '#999' }}>No orders this month yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Loyalty (Most Consistent) */}
        <div className="card">
          <h2 style={{ marginBottom: 12 }}>Top Loyalty (Most Consistent)</h2>
          <p style={{ color: '#666', fontSize: 14, marginBottom: 12 }}>
            Select up to 3 customers. Selected: {loyaltySelections.length}/3
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: 8 }}>Select</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Customer</th>
                <th style={{ textAlign: 'right', padding: 8 }}>Weeks Active</th>
                <th style={{ textAlign: 'right', padding: 8 }}>Orders</th>
              </tr>
            </thead>
            <tbody>
              {customerStats.byLoyalty.slice(0, 20).map((c, i) => (
                <tr
                  key={c.id}
                  style={{
                    borderBottom: '1px solid #f3f4f6',
                    background: loyaltySelections.includes(c.id) ? '#e8f5e9' : i < 3 ? '#fffde7' : undefined,
                  }}
                >
                  <td style={{ padding: 8 }}>
                    <input
                      type="checkbox"
                      checked={loyaltySelections.includes(c.id)}
                      onChange={() => toggleSelection(c.id, loyaltySelections, setLoyaltySelections)}
                    />
                  </td>
                  <td style={{ padding: 8 }}>{c.name}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{c.weeksActive}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{c.orderCount}</td>
                </tr>
              ))}
              {customerStats.byLoyalty.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 16, textAlign: 'center', color: '#999' }}>No orders this month yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Box>
    </div>
  );
}
