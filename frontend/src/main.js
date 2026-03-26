// main.js — GraphLens Frontend
import * as d3 from 'd3';
import './styles.css';
import { buildGraph, NODE_COLORS, NODE_RADII, LINK_COLORS } from './graph.js';
import { fetchData, sendChatMessage } from './api.js';

// ── HTML shell ───────────────────────────────────────────
document.querySelector('#app').innerHTML = `
<div class="app">
  <header>
    <div class="logo">GRAPH<span>LENS</span>
      <span style="font-size:10px;color:var(--text3);margin-left:6px;font-weight:400">SAP O2C</span>
    </div>
    <div class="hsep"></div>
    <div class="legend" id="legend"></div>
    <div class="hsep"></div>
    <div class="stats-bar" id="stats-bar">
      <div class="stat" style="color:var(--text3)">Loading…</div>
    </div>
  </header>

  <div class="graph-panel">
    <svg id="graph-svg"></svg>

    <div class="loading-overlay" id="loading">
      <div class="loading-spinner"></div>
      <div class="loading-text" id="loading-text">Fetching SAP data…</div>
    </div>

    <div class="graph-controls">
      <button class="ctrl-btn" id="zoom-in"     title="Zoom In">+</button>
      <button class="ctrl-btn" id="zoom-out"    title="Zoom Out">−</button>
      <button class="ctrl-btn" id="zoom-fit"    title="Fit Graph" style="font-size:11px">⊡</button>
      <button class="ctrl-btn" id="toggle-lbl"  title="Toggle Labels" style="font-size:10px">T</button>
    </div>

    <div class="node-search-wrap">
      <input id="node-search" type="text" placeholder="Search node ID or name…" />
    </div>

    <div class="tooltip" id="tooltip"></div>

    <div class="detail-panel" id="detail-panel">
      <div class="dp-close" id="dp-close">✕</div>
      <div class="dp-type" id="dp-type"></div>
      <div class="dp-id"   id="dp-id"></div>
      <div id="dp-fields"></div>
      <div class="dp-nbrs" id="dp-nbrs"></div>
    </div>
  </div>

  <div class="chat-panel">
    <div class="chat-hdr">
      <h2>NL Query Interface</h2>
      <div class="chat-status-dot" id="chat-dot"></div>
    </div>
    <div class="chat-msgs" id="chat-msgs"></div>
    <div class="suggestions">
      <div class="suggestions-label">Sample Queries</div>
      <button class="sugg-chip" data-q="Which products are associated with the highest number of billing documents?">Products with most billing docs</button>
      <button class="sugg-chip" data-q="Trace the full flow of billing document 90504274 — Sales Order → Delivery → Billing → Payment → Journal Entry">Trace billing doc 90504274</button>
      <button class="sugg-chip" data-q="Identify sales orders that have incomplete or broken flows — delivered but not billed, or billed without delivery">Find incomplete order flows</button>
      <button class="sugg-chip" data-q="Show top customers ranked by total sales order value with order counts">Top customers by revenue</button>
    </div>
    <div class="chat-input-area">
      <textarea class="chat-input" id="chat-input"
        placeholder="Ask about orders, billing, deliveries…" rows="1"></textarea>
      <button class="send-btn" id="send-btn">
        <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
      </button>
    </div>
  </div>
</div>
`;

// ── State ────────────────────────────────────────────────
let G            = null;   // { nodes, links, nodeMap }
let svgSel, zoomBeh, simul;
let nodesSel, linksSel, labelGrp;
let showLabels = true;
let curZoom    = d3.zoomIdentity;
let history    = [];       // conversation history [{role, content}]

// ── Boot ─────────────────────────────────────────────────
async function init() {
  try {
    setLoadingText('Fetching SAP data…');
    const data = await fetchData();
    setLoadingText('Building graph…');
    G = buildGraph(data);
    document.getElementById('loading').classList.add('hidden');
    buildLegend();
    buildStats(data);
    initGraph();
    initChat();
    addMsg('assistant',
      `Welcome to GraphLens — SAP Order-to-Cash Analysis.\n\n` +
      `Loaded: ${data.salesOrderHeaders.length} sales orders · ` +
      `${data.salesOrderItems.length} items · ` +
      `${data.deliveryHeaders.length} deliveries · ` +
      `${data.billingDocuments.length} billing docs · ` +
      `${data.payments.length} payments · ` +
      `${data.businessPartners.length} customers · ` +
      `${data.productDescriptions.length} products\n\n` +
      `Click any node to inspect it, or ask a question below.`
    );
  } catch (err) {
    setLoadingText(`❌ ${err.message}`);
    console.error(err);
  }
}

function setLoadingText(t) {
  document.getElementById('loading-text').textContent = t;
}

// ── Legend ───────────────────────────────────────────────
function buildLegend() {
  const el = document.getElementById('legend');
  Object.entries(NODE_COLORS).forEach(([type, color]) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<div class="legend-dot" style="background:${color}"></div>${type}`;
    item.addEventListener('click', () => {
      const nd = G.nodes.find(n => n.type === type);
      if (nd) focusNode(nd.id);
    });
    el.appendChild(item);
  });
}

// ── Stats Bar ────────────────────────────────────────────
function buildStats(data) {
  document.getElementById('stats-bar').innerHTML = `
    <div class="stat"><b>${G.nodes.length}</b> nodes</div>
    <div class="stat"><b>${G.links.length}</b> edges</div>
    <div class="stat"><b>${data.salesOrderHeaders.length}</b> orders</div>
    <div class="stat"><b>${data.billingDocuments.length}</b> billing</div>
    <div class="stat"><b>${data.payments.length}</b> payments</div>
  `;
}

// ── D3 Force Graph ───────────────────────────────────────
function initGraph() {
  const panel = document.querySelector('.graph-panel');
  const W = panel.offsetWidth;
  const H = panel.offsetHeight;

  svgSel = d3.select('#graph-svg');
  const root   = svgSel.append('g');
  const linksG = root.append('g');
  const nodesG = root.append('g');

  // Arrow marker
  svgSel.append('defs').append('marker')
    .attr('id', 'arr').attr('viewBox', '0 -4 10 8')
    .attr('refX', 18).attr('refY', 0)
    .attr('markerWidth', 5).attr('markerHeight', 5)
    .attr('orient', 'auto')
    .append('path').attr('d', 'M0,-4L10,0L0,4').attr('fill', '#222b3a');

  zoomBeh = d3.zoom().scaleExtent([0.04, 6]).on('zoom', e => {
    curZoom = e.transform;
    root.attr('transform', e.transform);
  });
  svgSel.call(zoomBeh);

  simul = d3.forceSimulation(G.nodes)
    .force('link', d3.forceLink(G.links).id(d => d.id)
      .distance(d => {
        if (d.source.type === 'SalesOrder' && d.target.type === 'SalesOrderItem') return 45;
        if (['Plant','Product'].includes(d.target.type)) return 65;
        return 90;
      })
      .strength(0.4))
    .force('charge',    d3.forceManyBody().strength(-200))
    .force('center',    d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide(d => NODE_RADII[d.type] + 10));

  // Links
  linksSel = linksG.selectAll('.link').data(G.links).enter()
    .append('path').attr('class', 'link')
    .attr('stroke',       d => LINK_COLORS[d.label] || '#1a2030')
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.5)
    .attr('marker-end', 'url(#arr)');

  // Nodes
  const tip = document.getElementById('tooltip');

  nodesSel = nodesG.selectAll('.node').data(G.nodes).enter()
    .append('g').attr('class', d => `node node-${d.type}`)
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) simul.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end',   (e, d) => { if (!e.active) simul.alphaTarget(0); d.fx = d.fy = null; })
    )
    .on('mouseover', (e, d) => showTip(e, d, tip))
    .on('mousemove', (e)    => moveTip(e, tip))
    .on('mouseout',  ()     => { tip.style.display = 'none'; })
    .on('click',     (e, d) => { e.stopPropagation(); showDetail(d); });

  nodesSel.append('circle')
    .attr('r',             d => NODE_RADII[d.type])
    .attr('fill',          d => NODE_COLORS[d.type])
    .attr('fill-opacity',  0.8)
    .attr('stroke',        d => NODE_COLORS[d.type])
    .attr('stroke-width',  1.5)
    .attr('stroke-opacity', 0.5);

  labelGrp = nodesSel.append('g').attr('class', 'lbl');
  labelGrp.append('text')
    .attr('dy', d => NODE_RADII[d.type] + 10)
    .attr('text-anchor', 'middle')
    .attr('font-size', '9px')
    .text(d => {
      if (d.type === 'BusinessPartner') return d.data.name?.substring(0, 16) || d.id;
      if (d.type === 'Product')         return d.data.description?.substring(0, 14) || d.id;
      if (d.type === 'Plant')           return d.data.name?.substring(0, 14) || d.id;
      return d.id.length > 14 ? d.id.substring(0, 13) + '…' : d.id;
    });

  simul.on('tick', () => {
    linksSel.attr('d', d => {
      const dx = d.target.x - d.source.x;
      const dy = d.target.y - d.source.y;
      const dr = Math.sqrt(dx * dx + dy * dy) * 1.2;
      return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
    });
    nodesSel.attr('transform', d => `translate(${d.x},${d.y})`);
  });

  // Controls
  const gpW = () => document.querySelector('.graph-panel').offsetWidth;
  const gpH = () => document.querySelector('.graph-panel').offsetHeight;
  document.getElementById('zoom-in').addEventListener('click', () => svgSel.transition().call(zoomBeh.scaleBy, 1.4));
  document.getElementById('zoom-out').addEventListener('click', () => svgSel.transition().call(zoomBeh.scaleBy, 0.7));
  document.getElementById('zoom-fit').addEventListener('click', () =>
    svgSel.transition().duration(600).call(
      zoomBeh.transform,
      d3.zoomIdentity.translate(gpW() * 0.1, gpH() * 0.1).scale(0.65)
    )
  );
  document.getElementById('toggle-lbl').addEventListener('click', () => {
    showLabels = !showLabels;
    labelGrp.attr('display', showLabels ? null : 'none');
  });

  // Node search
  document.getElementById('node-search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { clearHighlight(); return; }
    const found = G.nodes.find(n =>
      n.id.toLowerCase().includes(q) ||
      JSON.stringify(n.data).toLowerCase().includes(q)
    );
    if (found) focusNode(found.id);
  });

  // Click canvas → deselect
  svgSel.on('click', () => {
    document.getElementById('detail-panel').style.display = 'none';
    clearHighlight();
  });
}

// ── Tooltip ──────────────────────────────────────────────
function showTip(e, d, tip) {
  const rows = Object.entries(d.data).slice(0, 5).map(([k, v]) =>
    `<div class="tt-row"><span>${k}</span><b>${String(v).substring(0, 26)}</b></div>`
  ).join('');
  tip.innerHTML = `
    <div class="tt-type" style="color:${NODE_COLORS[d.type]}">${d.type}</div>
    <div class="tt-id">${d.id}</div>${rows}`;
  tip.style.display = 'block';
  moveTip(e, tip);
}
function moveTip(e, tip) {
  const r = document.querySelector('.graph-panel').getBoundingClientRect();
  let x = e.clientX - r.left + 12;
  let y = e.clientY - r.top  - 10;
  if (x + 270 > r.width) x -= 280;
  tip.style.left = x + 'px';
  tip.style.top  = y + 'px';
}

// ── Detail Panel ─────────────────────────────────────────
function showDetail(d) {
  const panel = document.getElementById('detail-panel');
  document.getElementById('dp-type').textContent  = d.type;
  document.getElementById('dp-type').style.color  = NODE_COLORS[d.type];
  document.getElementById('dp-id').textContent    = d.id;

  document.getElementById('dp-fields').innerHTML = Object.entries(d.data)
    .filter(([k]) => k !== 'id')
    .map(([k, v]) => `
      <div class="dp-row">
        <span class="dp-key">${k}</span>
        <span class="dp-val" title="${v}">${String(v).substring(0, 28)}</span>
      </div>`)
    .join('');

  const nbrs = G.links
    .filter(l => l.source.id === d.id || l.target.id === d.id)
    .map(l => l.source.id === d.id ? l.target : l.source)
    .filter((n, i, a) => a.findIndex(x => x.id === n.id) === i);

  const nbrsEl = document.getElementById('dp-nbrs');
  if (nbrs.length > 0) {
    nbrsEl.innerHTML = `<div class="dp-nbr-title">Connected (${nbrs.length})</div>` +
      nbrs.map(n =>
        `<span class="dp-nbr" data-id="${n.id}"
          style="background:${NODE_COLORS[n.type]}22;color:${NODE_COLORS[n.type]};border:1px solid ${NODE_COLORS[n.type]}44">
          ${n.id.substring(0, 18)}
        </span>`
      ).join('');
    nbrsEl.querySelectorAll('.dp-nbr').forEach(chip =>
      chip.addEventListener('click', () => focusNode(chip.dataset.id))
    );
  } else {
    nbrsEl.innerHTML = '';
  }

  panel.style.display = 'block';
  highlightNeighbors(d.id);
}

document.getElementById('dp-close').addEventListener('click', () => {
  document.getElementById('detail-panel').style.display = 'none';
  clearHighlight();
});

// ── Highlight helpers ────────────────────────────────────
function highlightNeighbors(id) {
  const nids = new Set([id]);
  G.links.forEach(l => {
    if (l.source.id === id) nids.add(l.target.id);
    if (l.target.id === id) nids.add(l.source.id);
  });
  nodesSel.select('circle')
    .attr('fill-opacity',   d => nids.has(d.id) ? 1 : 0.12)
    .attr('stroke-opacity', d => nids.has(d.id) ? 1 : 0.06);
  linksSel.attr('stroke-opacity', l =>
    (l.source.id === id || l.target.id === id) ? 1 : 0.04);
  labelGrp.attr('opacity', d => nids.has(d.id) ? 1 : 0.08);
}

export function highlightNodes(ids) {
  const idSet       = new Set(ids);
  const neighborhood = new Set(ids);
  G.links.forEach(l => {
    if (idSet.has(l.source.id)) neighborhood.add(l.target.id);
    if (idSet.has(l.target.id)) neighborhood.add(l.source.id);
  });
  nodesSel.select('circle')
    .attr('fill-opacity',   d => neighborhood.has(d.id) ? 1 : 0.12)
    .attr('stroke-opacity', d => idSet.has(d.id) ? 1 : 0.06);
  linksSel.attr('stroke-opacity', l =>
    (idSet.has(l.source.id) || idSet.has(l.target.id)) ? 1 : 0.04);
  labelGrp.attr('opacity', d => neighborhood.has(d.id) ? 1 : 0.08);
}

function clearHighlight() {
  if (!nodesSel) return;
  nodesSel.select('circle').attr('fill-opacity', 0.8).attr('stroke-opacity', 0.5);
  linksSel.attr('stroke-opacity', 0.5);
  labelGrp.attr('opacity', 1);
}

function focusNode(id) {
  const nd = G.nodes.find(n => n.id === id);
  if (!nd) return;
  showDetail(nd);
  const s = curZoom.k;
  const W = document.querySelector('.graph-panel').offsetWidth;
  const H = document.querySelector('.graph-panel').offsetHeight;
  svgSel.transition().duration(500).call(
    zoomBeh.transform,
    d3.zoomIdentity.translate(W / 2 - nd.x * s, H / 2 - nd.y * s).scale(s)
  );
}

// ── Chat ─────────────────────────────────────────────────
function initChat() {
  document.getElementById('send-btn').addEventListener('click', () =>
    sendMessage(document.getElementById('chat-input').value)
  );
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e.target.value); }
  });
  document.getElementById('chat-input').addEventListener('input', e => {
    e.target.style.height = '34px';
    e.target.style.height = Math.min(e.target.scrollHeight, 90) + 'px';
  });
  document.querySelectorAll('.sugg-chip').forEach(chip =>
    chip.addEventListener('click', () => sendMessage(chip.dataset.q))
  );
}

// async function sendMessage(text) {
//   if (!text.trim()) return;

//   const inputEl  = document.getElementById('chat-input');
//   const sendBtn  = document.getElementById('send-btn');
//   const statusDot = document.getElementById('chat-dot');

//   addMsg('user', text);
//   inputEl.value      = '';
//   inputEl.style.height = '34px';

//   const thinkEl = addThinking();
//   statusDot.className = 'chat-status-dot thinking';
//   sendBtn.disabled = true;

//   history.push({ role: 'user', content: text });

//   try {
//     const rawText = await sendChatMessage(history, () => {});
//     thinkEl.remove();
//     statusDot.className = 'chat-status-dot';
//     sendBtn.disabled = false;

//     history.push({ role: 'assistant', content: rawText });

//     const parsed  = parseResponse(rawText);
//     const isGuard = parsed.query_type === 'guardrail' ||
//       parsed.answer?.includes('designed to answer questions about the SAP');

//     addMsg('assistant', parsed.answer || rawText, {
//       sql:       isGuard ? null : parsed.sql,
//       data:      isGuard ? []   : (parsed.data || []),
//       guardrail: isGuard,
//     });

//     // Highlight referenced graph nodes
//     if (!isGuard && parsed.highlight_nodes?.length > 0 && G) {
//       const valid = parsed.highlight_nodes.filter(id => G.nodeMap[id]);
//       if (valid.length > 0) {
//         highlightNodes(valid);
//         focusNode(valid[0]);
//       }
//     }

//   } catch (err) {
//     thinkEl?.remove();
//     statusDot.className = 'chat-status-dot';
//     sendBtn.disabled = false;
//     addMsg('assistant', `Error: ${err.message}`);
//     console.error(err);
//   }
// }

async function sendMessage(text) {
  if (!text.trim()) return;

  const inputEl   = document.getElementById('chat-input');
  const sendBtn   = document.getElementById('send-btn');
  const statusDot = document.getElementById('chat-dot');

  addMsg('user', text);
  inputEl.value = '';
  inputEl.style.height = '34px';

  const thinkEl = addThinking();
  statusDot.className = 'chat-status-dot thinking';
  sendBtn.disabled = true;

  history.push({ role: 'user', content: text });

  try {
    // ✅ CALL NEW API (NO STREAMING)
    const res = await sendChatMessage(history);

    thinkEl.remove();
    statusDot.className = 'chat-status-dot';
    sendBtn.disabled = false;

    console.log("🟢 FRONTEND RESPONSE:", res);

    // ✅ HANDLE RESPONSE
    const parsed = res.parsed || {
      answer: res.raw,
      data: [],
      highlight_nodes: [],
      query_type: 'data_query'
    };

    history.push({
      role: 'assistant',
      content: parsed.answer || res.raw
    });

    const isGuard =
      parsed.query_type === 'guardrail' ||
      parsed.answer?.includes('designed to answer');

    // ✅ DISPLAY MESSAGE
    addMsg('assistant', parsed.answer || res.raw, {
      sql: parsed.sql || null,
      data: parsed.data || [],
      guardrail: isGuard,
    });

    // ✅ HIGHLIGHT GRAPH NODES
    if (!isGuard && parsed.highlight_nodes?.length > 0 && G) {
      const valid = parsed.highlight_nodes.filter(id => G.nodeMap[id]);
      if (valid.length > 0) {
        highlightNodes(valid);
        focusNode(valid[0]);
      }
    }

  } catch (err) {
    thinkEl?.remove();
    statusDot.className = 'chat-status-dot';
    sendBtn.disabled = false;

    addMsg('assistant', `Error: ${err.message}`);
    console.error(err);
  }
}

// ── Message rendering ────────────────────────────────────
function addMsg(role, content, extra = {}) {
  const msgs = document.getElementById('chat-msgs');
  const wrap = document.createElement('div');
  wrap.className = `msg msg-${role}`;

  let html = '';
  if (role === 'assistant') {
    if (extra.guardrail) html += `<div class="guard-badge">⚠ Out of scope</div>\n`;
    if (extra.sql)       html += `<div class="sql-label">Generated SQL</div><div class="sql-block">${esc(extra.sql)}</div>`;
    html += `<div class="msg-bubble">${esc(content).replace(/\n/g, '<br>')}</div>`;

    if (extra.data?.length > 0) {
      const cols = Object.keys(extra.data[0]);
      html += `<table class="result-table"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>`;
      html += extra.data.slice(0, 10).map(row =>
        `<tr>${cols.map(c => `<td>${esc(String(row[c] ?? ''))}</td>`).join('')}</tr>`
      ).join('');
      html += `</tbody></table>`;
    }
  } else {
    html = `<div class="msg-bubble">${esc(content)}</div>`;
  }

  wrap.innerHTML = html;
  const meta = document.createElement('div');
  meta.className   = 'msg-meta';
  meta.textContent = role === 'user' ? 'You' : 'GraphLens';
  wrap.appendChild(meta);
  msgs.appendChild(wrap);
  msgs.scrollTop = msgs.scrollHeight;
  return wrap;
}

function addThinking() {
  const msgs = document.getElementById('chat-msgs');
  const div  = document.createElement('div');
  div.className = 'msg msg-assistant';
  div.innerHTML = `<div class="thinking-dots"><span></span><span></span><span></span></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Start ────────────────────────────────────────────────
init();
