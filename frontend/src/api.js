// // api.js — GraphLens backend client

// const BASE = '/api';

// /** Fetch the full SAP dataset for graph construction */
// export async function fetchData() {
//   const res = await fetch(`${BASE}/data`);
//   if (!res.ok) throw new Error(`fetchData: ${res.status} ${res.statusText}`);
//   return res.json();
// }

// /** Fetch summary statistics */
// export async function fetchStats() {
//   const res = await fetch(`${BASE}/stats`);
//   if (!res.ok) throw new Error(`fetchStats: ${res.status} ${res.statusText}`);
//   return res.json();
// }

// /**
//  * Stream a chat message.
//  * @param {Array}    messages  Full conversation history [{role, content}]
//  * @param {Function} onChunk   Called with each streamed text chunk
//  * @returns {string}           Complete response text
//  */
// export async function sendChatMessage(messages, onChunk) {
//   const res = await fetch(`${BASE}/chat`, {
//     method:  'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body:    JSON.stringify({ messages }),
//   });

//   if (!res.ok) {
//     const err = await res.json().catch(() => ({ error: res.statusText }));
//     throw new Error(err.error || `HTTP ${res.status}`);
//   }

//   const reader  = res.body.getReader();
//   const decoder = new TextDecoder();
//   let fullText = '';
//   let buffer   = '';

//   while (true) {
//     const { done, value } = await reader.read();
//     if (done) break;

//     buffer += decoder.decode(value, { stream: true });
//     const lines = buffer.split('\n');
//     buffer = lines.pop(); // keep incomplete line

//     for (const line of lines) {
//       if (!line.startsWith('data: ')) continue;
//       try {
//         const event = JSON.parse(line.slice(6));
//         if (event.type === 'text') {
//           fullText += event.text;
//           onChunk?.(event.text);
//         } else if (event.type === 'done') {
//           fullText = event.fullText || fullText;
//         } else if (event.type === 'error') {
//           throw new Error(event.error);
//         }
//       } catch (_) {
//         // ignore malformed SSE lines
//       }
//     }
//   }

//   return fullText;
// }

// /**
//  * Parse a raw LLM response string into a structured object.
//  * Extracts the first JSON block found in the text.
//  */
// export function parseResponse(rawText) {
//   try {
//     const match = rawText.match(/\{[\s\S]*\}/);
//     if (match) return JSON.parse(match[0]);
//   } catch (_) { /* fall through */ }
//   return { sql: null, answer: rawText, data: [], highlight_nodes: [], query_type: 'data_query' };
// }

// api.js — GraphLens backend client (Groq + JSON version)

const BASE = '/api';

/** Fetch full dataset */
export async function fetchData() {
  const res = await fetch(`${BASE}/data`);
  if (!res.ok) throw new Error(`fetchData: ${res.status}`);
  return res.json();
}

/** Fetch stats */
export async function fetchStats() {
  const res = await fetch(`${BASE}/stats`);
  if (!res.ok) throw new Error(`fetchStats: ${res.status}`);
  return res.json();
}

/** ✅ Chat (Groq + JSON, no streaming) */
export async function sendChatMessage(messages) {
  const res = await fetch(`${BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const data = await res.json();

  console.log("✅ RESPONSE FROM BACKEND:", data);

  return data;
}
