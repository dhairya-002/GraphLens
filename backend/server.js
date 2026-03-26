// // server.js — GraphLens Backend API
// 'use strict';
// require('dotenv').config();

// const express = require('express');
// const cors = require('cors');
// const rateLimit = require('express-rate-limit');
// const Groq = require('groq-sdk');
// const fs = require('fs');
// const path = require('path');
// const { buildSchemaPrompt } = require('./schema');

// const app = express();
// const PORT = process.env.PORT || 3001;

// // ── Load SAP Data ─────────────────────────────────────────
// const DATA_PATH = path.join(__dirname, '../data/sap_data.json');
// if (!fs.existsSync(DATA_PATH)) {
//   console.error(`\n❌ ERROR: data/sap_data.json not found at ${DATA_PATH}`);
//   console.error('   Make sure the data file is in the /data directory.\n');
//   process.exit(1);
// }

// const SAP_DATA = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
// const SYSTEM_PROMPT = buildSchemaPrompt(SAP_DATA);

// console.log('\n✅ GraphLens — SAP O2C Backend');
// console.log('   Dataset loaded:');
// Object.entries(SAP_DATA).forEach(([k, v]) =>
//   console.log(`     ${k.padEnd(32)} ${v.length} records`)
// );

// if (!process.env.GROQ_API_KEY) {
//   console.error('\n❌ ERROR: GROQ_API_KEY is not set in .env\n');
//   process.exit(1);
// }
// const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// // ── Middleware ────────────────────────────────────────────
// const allowedOrigins = [
//   process.env.FRONTEND_URL || 'http://localhost:5173',
//   'http://localhost:3000',
//   'http://localhost:5173',
// ];
// app.use(cors({
//   origin: (origin, cb) => {
//     if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
//     cb(new Error(`CORS: origin ${origin} not allowed`));
//   },
//   credentials: true,
// }));
// app.use(express.json({ limit: '2mb' }));

// const apiLimiter = rateLimit({
//   windowMs: 60 * 1000,
//   max: 30,
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { error: 'Rate limit exceeded. Please wait a moment before retrying.' },
// });
// app.use('/api/', apiLimiter);

// // ── Routes ────────────────────────────────────────────────

// // Health check
// app.get('/api/health', (_req, res) => {
//   res.json({
//     status: 'ok',
//     timestamp: new Date().toISOString(),
//     records: Object.fromEntries(Object.entries(SAP_DATA).map(([k, v]) => [k, v.length])),
//   });
// });

// // Full dataset (used by frontend to build the D3 graph)
// app.get('/api/data', (_req, res) => {
//   res.json(SAP_DATA);
// });

// // Summary statistics
// app.get('/api/stats', (_req, res) => {
//   const bpMap = Object.fromEntries(
//     SAP_DATA.businessPartners.map(p => [p.customer, p.businessPartnerFullName])
//   );

//   const totalOrderValue = SAP_DATA.salesOrderHeaders
//     .reduce((s, o) => s + parseFloat(o.totalNetAmount || 0), 0);
//   const totalBillingValue = SAP_DATA.billingDocuments
//     .reduce((s, b) => s + parseFloat(b.totalNetAmount || 0), 0);
//   const totalPayments = SAP_DATA.payments
//     .reduce((s, p) => s + parseFloat(p.amountInTransactionCurrency || 0), 0);

//   const revenueByCustomer = {};
//   const ordersByCustomer = {};
//   SAP_DATA.salesOrderHeaders.forEach(o => {
//     revenueByCustomer[o.soldToParty] = (revenueByCustomer[o.soldToParty] || 0) + parseFloat(o.totalNetAmount || 0);
//     ordersByCustomer[o.soldToParty] = (ordersByCustomer[o.soldToParty] || 0) + 1;
//   });

//   const topCustomers = Object.entries(revenueByCustomer)
//     .sort((a, b) => b[1] - a[1])
//     .map(([id, rev]) => ({
//       id,
//       name: bpMap[id] || id,
//       revenue: rev.toFixed(2),
//       orderCount: ordersByCustomer[id] || 0,
//     }));

//   // Incomplete flow analysis
//   const ordersWithDelivery = new Set(
//     SAP_DATA.deliveryHeaders.map(d => d.shippingPoint) // not a perfect link but indicative
//   );
//   const billedCustomers = new Set(SAP_DATA.billingDocuments.map(b => b.soldToParty));
//   const paidAcctDocs = new Set(SAP_DATA.payments.map(p => p.accountingDocument));
//   const unpaidBillingCount = SAP_DATA.billingDocuments
//     .filter(b => !paidAcctDocs.has(b.accountingDocument)).length;

//   res.json({
//     counts: {
//       businessPartners: SAP_DATA.businessPartners.length,
//       salesOrders: SAP_DATA.salesOrderHeaders.length,
//       salesOrderItems: SAP_DATA.salesOrderItems.length,
//       deliveries: SAP_DATA.deliveryHeaders.length,
//       billingDocuments: SAP_DATA.billingDocuments.length,
//       payments: SAP_DATA.payments.length,
//       journalEntries: SAP_DATA.journalEntries.length,
//       products: SAP_DATA.productDescriptions.length,
//       plants: SAP_DATA.plants.length,
//     },
//     financials: {
//       totalOrderValue: totalOrderValue.toFixed(2),
//       totalBillingValue: totalBillingValue.toFixed(2),
//       totalPaymentsReceived: totalPayments.toFixed(2),
//       unpaidBillingDocuments: unpaidBillingCount,
//       currency: 'INR',
//     },
//     topCustomers,
//   });
// });

// // ── Chat endpoint with SSE streaming ──────────────────────
// app.post('/api/chat', async (req, res) => {
//   const { messages } = req.body;

//   if (!messages || !Array.isArray(messages) || messages.length === 0) {
//     return res.status(400).json({ error: 'messages array is required' });
//   }

//   // Sanitise messages
//   const cleanMessages = messages
//     .filter(m => m && typeof m.role === 'string' && typeof m.content === 'string')
//     .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));

//   if (cleanMessages.length === 0) {
//     return res.status(400).json({ error: 'No valid messages provided' });
//   }

//   // Set up Server-Sent Events
//   res.setHeader('Content-Type', 'text/event-stream');
//   res.setHeader('Cache-Control', 'no-cache');
//   res.setHeader('Connection', 'keep-alive');
//   res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
//   res.flushHeaders();

//   // Keep-alive ping every 15s
//   const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);

//   try {
//   const stream = await groq.chat.completions.create({
//     model: 'llama-3.3-70b-versatile',   // or 'mixtral-8x7b-32768', 'llama-3.1-8b-instant'
//     max_tokens: 1500,
//     messages: [
//       { role: 'system', content: SYSTEM_PROMPT },
//       ...cleanMessages,
//     ],
//     stream: true,
//   });

//   let fullText = '';

//   for await (const chunk of stream) {
//     const text = chunk.choices[0]?.delta?.content || '';
//     if (text) {
//       fullText += text;
//       res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
//     }
//   }

//   clearInterval(keepAlive);
//   res.write(`data: ${JSON.stringify({ type: 'done', fullText })}\n\n`);
//   res.end();

// } catch (err) {
//   clearInterval(keepAlive);
//   console.error('Chat handler error:', err.message);
//   if (!res.headersSent) {
//     res.status(500).json({ error: err.message });
//   } else {
//     res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
//     res.end();
//   }
// }
// });

// // 404 catch-all
// app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// // ── Start ─────────────────────────────────────────────────
// app.listen(PORT, () => {
//   console.log(`\n🚀 Backend listening on http://localhost:${PORT}`);
//   console.log(`   GET  /api/health`);
//   console.log(`   GET  /api/data`);
//   console.log(`   GET  /api/stats`);
//   console.log(`   POST /api/chat  (SSE streaming)\n`);
// });


// server.js — GraphLens Backend (Groq + JSON)

'use strict';
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');
const { buildSchemaPrompt } = require('./schema');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Load SAP Data ─────────────────────────────────────────
const DATA_PATH = path.join(__dirname, '../data/sap_data.json');

if (!fs.existsSync(DATA_PATH)) {
  console.error(`❌ ERROR: data file not found at ${DATA_PATH}`);
  process.exit(1);
}

const SAP_DATA = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
const SYSTEM_PROMPT = buildSchemaPrompt(SAP_DATA);

console.log('\n✅ SAP Data Loaded');

// ── Groq Setup ────────────────────────────────────────────
if (!process.env.GROQ_API_KEY) {
  console.error('❌ GROQ_API_KEY missing in .env');
  process.exit(1);
}

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
});
app.use('/api/', limiter);

// ── Routes ────────────────────────────────────────────────

// Health
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Data
app.get('/api/data', (_req, res) => {
  res.json(SAP_DATA);
});

// Stats
app.get('/api/stats', (_req, res) => {
  res.json({
    salesOrders: SAP_DATA.salesOrderHeaders.length,
    deliveries: SAP_DATA.deliveryHeaders.length,
    billing: SAP_DATA.billingDocuments.length,
  });
});

// ✅ CHAT (Groq + JSON, NO streaming)
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages required' });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages,
      ],
    });

    const text = completion.choices[0]?.message?.content || "";

    console.log("🧠 LLM RAW OUTPUT:\n", text);

    // Try extracting JSON from LLM response
    let parsed = null;
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch (e) {
      console.log("⚠️ JSON parse failed");
    }

    res.json({
      raw: text,
      parsed,
    });

  } catch (err) {
    console.error("❌ Groq Error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 404
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Backend running on http://localhost:${PORT}`);
});