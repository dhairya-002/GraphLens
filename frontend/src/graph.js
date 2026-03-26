// graph.js — builds D3 nodes and edges from SAP O2C data

export const NODE_COLORS = {
  BusinessPartner: '#6c63ff',
  SalesOrder:      '#00c8f0',
  SalesOrderItem:  '#38bdf8',
  Delivery:        '#00d48a',
  BillingDocument: '#ffc845',
  Payment:         '#ff5a5a',
  Product:         '#f97316',
  Plant:           '#a78bfa',
  JournalEntry:    '#f472b6',
};

export const NODE_RADII = {
  BusinessPartner: 14,
  SalesOrder:      12,
  SalesOrderItem:  7,
  Delivery:        11,
  BillingDocument: 11,
  Payment:         10,
  Product:         10,
  Plant:           10,
  JournalEntry:    8,
};

export const LINK_COLORS = {
  PLACED:     '#6c63ff55',
  HAS_ITEM:   '#00c8f044',
  MATERIAL:   '#f9731655',
  FROM_PLANT: '#a78bfa55',
  SHIPS_FROM: '#00d48a44',
  BILLED_TO:  '#ffc84555',
  SETTLED_BY: '#ff5a5a55',
  JOURNAL:    '#f472b644',
};

export function buildGraph(data) {
  const nodes   = [];
  const links   = [];
  const nodeMap = {};

  function addNode(id, type, displayData) {
    if (nodeMap[id]) return;
    const n = { id, type, data: displayData };
    nodeMap[id] = n;
    nodes.push(n);
  }

  function addLink(source, target, label) {
    if (nodeMap[source] && nodeMap[target]) {
      links.push({ source, target, label });
    }
  }

  // ── Business Partners ─────────────────────────
  data.businessPartners.forEach(b => addNode(b.customer, 'BusinessPartner', {
    id:       b.customer,
    name:     b.businessPartnerFullName,
    category: b.businessPartnerCategory,
    blocked:  String(b.businessPartnerIsBlocked),
    archived: String(b.isMarkedForArchiving),
    created:  b.creationDate?.substring(0, 10) ?? '—',
  }));

  // ── Products ──────────────────────────────────
  data.productDescriptions.forEach(p => addNode(p.product, 'Product', {
    id:          p.product,
    description: p.productDescription,
    language:    p.language,
  }));

  // ── Plants (only those referenced in O2C flow) ─
  const usedPlantIds = new Set([
    ...data.salesOrderItems.map(i => i.productionPlant),
    ...data.deliveryHeaders.map(d => d.shippingPoint),
  ].filter(Boolean));

  data.plants.filter(p => usedPlantIds.has(p.plant)).forEach(p => addNode(p.plant, 'Plant', {
    id:      p.plant,
    name:    p.plantName,
    salesOrg: p.salesOrganization,
    calendar: p.factoryCalendar,
  }));

  // ── Sales Orders ──────────────────────────────
  data.salesOrderHeaders.forEach(s => addNode(s.salesOrder, 'SalesOrder', {
    id:             s.salesOrder,
    customer:       s.soldToParty,
    date:           s.creationDate?.substring(0, 10) ?? '—',
    amount:         parseFloat(s.totalNetAmount || 0).toFixed(2),
    currency:       s.transactionCurrency,
    deliveryStatus: s.overallDeliveryStatus  || '—',
    billingStatus:  s.overallOrdReltdBillgStatus || '—',
    type:           s.salesOrderType,
    paymentTerms:   s.customerPaymentTerms,
  }));

  // ── Sales Order Items ─────────────────────────
  data.salesOrderItems.forEach(i => {
    const id = `${i.salesOrder}-${i.salesOrderItem}`;
    addNode(id, 'SalesOrderItem', {
      salesOrder: i.salesOrder,
      item:       i.salesOrderItem,
      material:   i.material,
      qty:        i.requestedQuantity,
      unit:       i.requestedQuantityUnit,
      amount:     parseFloat(i.netAmount || 0).toFixed(2),
      currency:   i.transactionCurrency,
      plant:      i.productionPlant,
    });
  });

  // ── Deliveries ────────────────────────────────
  data.deliveryHeaders.forEach(d => addNode(d.deliveryDocument, 'Delivery', {
    id:            d.deliveryDocument,
    date:          d.creationDate?.substring(0, 10) ?? '—',
    shippingPoint: d.shippingPoint,
    goodsMvmt:     d.overallGoodsMovementStatus || '—',
    picking:       d.overallPickingStatus || '—',
    billingBlock:  d.headerBillingBlockReason || 'None',
  }));

  // ── Billing Documents ─────────────────────────
  data.billingDocuments.forEach(b => addNode(b.billingDocument, 'BillingDocument', {
    id:           b.billingDocument,
    type:         b.billingDocumentType,
    date:         b.billingDocumentDate?.substring(0, 10) ?? '—',
    amount:       parseFloat(b.totalNetAmount || 0).toFixed(2),
    currency:     b.transactionCurrency,
    customer:     b.soldToParty,
    accountingDoc: b.accountingDocument,
    cancelled:    String(b.billingDocumentIsCancelled),
    fiscalYear:   b.fiscalYear,
  }));

  // ── Payments ──────────────────────────────────
  data.payments.forEach(p => {
    const id = `PAY-${p.accountingDocument}-${p.accountingDocumentItem}`;
    addNode(id, 'Payment', {
      accountingDoc: p.accountingDocument,
      item:          p.accountingDocumentItem,
      customer:      p.customer,
      clearingDate:  p.clearingDate?.substring(0, 10) ?? '—',
      amount:        parseFloat(p.amountInTransactionCurrency || 0).toFixed(2),
      currency:      p.transactionCurrency,
      glAccount:     p.glAccount,
      postingDate:   p.postingDate?.substring(0, 10) ?? '—',
    });
  });

  // ── Journal Entries ───────────────────────────
  data.journalEntries.forEach(j => {
    const id = `JE-${j.accountingDocument}-${j.accountingDocumentItem}`;
    addNode(id, 'JournalEntry', {
      accountingDoc: j.accountingDocument,
      billingDoc:    j.referenceDocument,
      customer:      j.customer,
      amount:        parseFloat(j.amountInTransactionCurrency || 0).toFixed(2),
      postingDate:   j.postingDate?.substring(0, 10) ?? '—',
      glAccount:     j.glAccount,
      docType:       j.accountingDocumentType,
      profitCenter:  j.profitCenter,
    });
  });

  // ── Edges ─────────────────────────────────────

  // Customer → SalesOrder
  data.salesOrderHeaders.forEach(s => addLink(s.soldToParty, s.salesOrder, 'PLACED'));

  // SalesOrder → Item → Product / Plant
  data.salesOrderItems.forEach(i => {
    const itemId = `${i.salesOrder}-${i.salesOrderItem}`;
    addLink(i.salesOrder, itemId, 'HAS_ITEM');
    if (i.material)        addLink(itemId, i.material, 'MATERIAL');
    if (i.productionPlant) addLink(itemId, i.productionPlant, 'FROM_PLANT');
  });

  // Delivery → Plant (shippingPoint)
  data.deliveryHeaders.forEach(d => {
    if (d.shippingPoint && nodeMap[d.shippingPoint]) {
      addLink(d.deliveryDocument, d.shippingPoint, 'SHIPS_FROM');
    }
  });

  // Customer → BillingDocument
  data.billingDocuments.forEach(b => addLink(b.soldToParty, b.billingDocument, 'BILLED_TO'));

  // BillingDocument → Payment  (via accountingDocument)
  const billAcctMap = {};
  data.billingDocuments.forEach(b => { billAcctMap[b.accountingDocument] = b.billingDocument; });
  data.payments.forEach(p => {
    const billDoc = billAcctMap[p.accountingDocument];
    if (billDoc) addLink(billDoc, `PAY-${p.accountingDocument}-${p.accountingDocumentItem}`, 'SETTLED_BY');
  });

  // BillingDocument → JournalEntry  (billingDocument = referenceDocument)
  data.journalEntries.forEach(j => {
    if (nodeMap[j.referenceDocument]) {
      addLink(j.referenceDocument, `JE-${j.accountingDocument}-${j.accountingDocumentItem}`, 'JOURNAL');
    }
  });

  return { nodes, links, nodeMap };
}
