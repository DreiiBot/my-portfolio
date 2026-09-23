// POSIBLI and its two largest modules: InventoNet procurement and Invoicing / AR.

export const posibli = {
  modules: [
    {
      key: 'A',
      label: 'POS / Retail',
      title: 'Checkout to executive reports',
      body: 'Catalog and variants, multi-store checkout, refunds, receipts and cashier operations, plus sales, profitability, executive and inventory-valuation reporting.',
    },
    {
      key: 'B',
      label: 'Inventory',
      title: 'Ledger-based stock',
      body: 'Inventory ledger, physical counts and adjustments, warehouses and locations, weighted-average costing, bills of materials and bundles. Balances and transactions are mirrored from MongoDB into PostgreSQL.',
    },
    {
      key: 'C',
      label: 'Loyverse sync',
      title: 'Two-way synchronization',
      body: 'Products, inventory, sales and customer data kept in sync with Loyverse in both directions, including checkout/refund integration and webhook processing.',
    },
    {
      key: 'D',
      label: 'Loyalty',
      title: 'Points wired into checkout',
      body: 'Points and rewards, loyalty transactions and customer identification, exposed through loyalty APIs that other modules use.',
    },
    {
      key: 'E',
      label: 'Proximity marketing',
      title: 'Targeted in-store engagement',
      body: 'Lets businesses use customer and store interaction data to reach customers with targeted engagement.',
    },
    {
      key: 'F',
      label: 'Ordering & integrations',
      title: 'Open to other systems',
      body: 'Ordering workflows, and integration clients with their own API authentication, integration-specific permissions and webhooks for cross-system communication.',
    },
  ],
}

export const procurementPipeline = [
  'Requisition',
  'Approval',
  'RFQ',
  'Supplier quotes',
  'Evaluate / award',
  'Purchase order',
  'PO authorization',
  'Receiving',
  'Supplier invoice',
  'Verification',
  'Three-way match',
  'Returns / credits',
]

export const inventonet = {
  highlights: [
    {
      title: 'Approvals and budgets',
      body: 'Amount-, role- and department-based approval rules. Department and category budgets with commitment tracking, checked at requisition submission and again at PO authorization.',
    },
    {
      title: 'Receiving that reflects reality',
      body: 'Partial receipts; rejected, damaged and missing quantities; batch, serial and expiry tracking; over-receipt tolerance; posting straight into inventory valuation.',
    },
    {
      title: 'Suppliers who are also customers',
      body: 'A supplier that is itself a POSIBLI store quotes, accepts POs, marks them dispatched and submits invoices from its own account, with cross-tenant store linking.',
    },
  ],
  more: [
    {
      title: 'Sourcing',
      items: ['Supplier invitations', 'Side-by-side quotation comparison', 'Optional weighted evaluation', 'Award workflow'],
    },
    {
      title: 'Accounts payable',
      items: ['Invoice verification', 'Discrepancy detection', 'PO ↔ receipt ↔ invoice matching', 'Invoice status management'],
    },
    {
      title: 'Returns & credit notes',
      items: ['Returns against specific delivery lines', 'Returnable-quantity limits, atomic validation', 'Credit notes applied to approved invoices', 'Budget actuals reversed by credited amount'],
    },
    {
      title: 'Supplier performance',
      items: ['On-time delivery, quality, responsiveness', 'Composite supplier score', 'Missing metrics handled independently — never counted as zero'],
    },
    {
      title: 'Analytics',
      items: ['Dashboard with KPI tiles', 'Budget summary and exceptions', 'Spend trends', '17 reports with shared filters'],
    },
    {
      title: 'Foundation',
      items: ['Departments & procurement config', 'Event logging and audit history', 'Generic notifications & attachments', '~180 capability keys with per-employee overrides'],
    },
  ],
}

export const invoicing = {
  eventLabels: [
    'Invoice issued',
    'partially paid',
    'paid',
    'cancelled',
    'voided',
    'credited',
    'refunded',
    'credit note issued',
    'payment completed',
    'payment reversed',
    'refund completed',
  ],
}
