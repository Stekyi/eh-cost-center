import React from "react";

type LocationItem = {
  key: string;
  label: string;
  customers: any[];
  customersCount: number;
  ordersCount: number;
  ordersAmount: number;
};

export default function LocationBubbles({
  bubbles,
  metricMode,
  onBubbleClick,
}: {
  bubbles: LocationItem[];
  metricMode: "customers" | "orders";
  onBubbleClick: (key: string, label: string) => void;
}) {
  if (!bubbles || !bubbles.length) {
    return <p style={{ fontSize: 13, color: "#6b7280" }}>No location data</p>;
  }

  const maxMetric = Math.max(
    ...bubbles.map((b) => (metricMode === "customers" ? b.customersCount : b.ordersCount))
  ) || 1;

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      {bubbles.map((b) => {
        const metric = metricMode === "customers" ? b.customersCount : b.ordersCount;
        // Normalize into pixel diameter between 48 and 140
        const size = 48 + Math.round((metric / maxMetric) * 92);
        return (
          <button
            key={b.key}
            onClick={() => onBubbleClick(b.key, b.label)}
            style={{
              width: size,
              height: size,
              borderRadius: "50%",
              border: "1px solid #e5e7eb",
              background: "linear-gradient(135deg,#fff 0%,#f8fafc 100%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: 8,
              boxShadow: "0 4px 8px rgba(0,0,0,0.06)",
            }}
            title={`${b.label}\nCustomers: ${b.customersCount}\nOrders: ${b.ordersCount}\nAmount: ${Number(b.ordersAmount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}
          >
            <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", textAlign: "center" }}>
              {b.label.length > 16 ? b.label.slice(0, 13) + "..." : b.label}
            </div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
              {metricMode === "customers" ? `${b.customersCount} cust` : `${b.ordersCount} ord`}
            </div>
          </button>
        );
      })}
    </div>
  );
}