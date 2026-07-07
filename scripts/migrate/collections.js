// Shared collection → table mapping used by the export/import migration scripts.
// Keep this the single source of truth so export and import never drift.

// Top-level Firestore collections and the Neon table each maps to.
const COLLECTIONS = [
  { collection: 'customers',              table: 'customers' },
  { collection: 'products',               table: 'products' },
  { collection: 'orders',                 table: 'orders' },
  { collection: 'revenue',                table: 'revenue' },
  { collection: 'expenseItems',           table: 'expense_items' },
  { collection: 'expenseItems_audit',     table: 'expense_items_audit' },
  { collection: 'expenseItems_archive',   table: 'expense_items_archive' },
  { collection: 'expenseCategories',      table: 'expense_categories' },
  { collection: 'customerCategories',     table: 'customer_categories' },
  { collection: 'customerAllergies',      table: 'customer_allergies' },
  { collection: 'staff',                  table: 'staff' },
  { collection: 'assets',                 table: 'assets' },
  { collection: 'top_customers',          table: 'top_customers' },
  { collection: 'customer_followups',     table: 'customer_followups' },
  { collection: 'gallery',                table: 'gallery' },
  { collection: 'delivery_assignments',   table: 'delivery_assignments' },
  { collection: 'product_reviews',        table: 'product_reviews' },
  { collection: 'orders_audit',           table: 'orders_audit' },
  { collection: 'product_audit',          table: 'product_audit' },
  { collection: 'rag_embeddings',         table: 'rag_embeddings' },
  { collection: 'rag_rate_limits',        table: 'rag_rate_limits' },
]

// Subcollections: orders/{orderId}/payments → order_payments (with order_id FK).
const SUBCOLLECTIONS = [
  { parent: 'orders', sub: 'payments', table: 'order_payments', fk: 'order_id' },
]

module.exports = { COLLECTIONS, SUBCOLLECTIONS }
