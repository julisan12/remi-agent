// src/mcp-http.js
// Remi MCP Gateway — GHL + Meta Ads
//
// Servicio independiente: Railway lo corre con "node src/mcp-http.js"
// (servicio separado del web server, mismo repositorio)
//
// Variables de entorno requeridas:
//   REMI_MCP_TOKEN        — bearer token para autenticación
//   GHL_API_KEY           — API key de GoHighLevel
//   GHL_LOCATION_ID       — Location ID de la subcuenta GHL
//   GHL_BASE_URL          — https://services.leadconnectorhq.com
//   META_ACCESS_TOKEN     — token de acceso de Meta Ads
//   META_AD_ACCOUNT_ID    — formato: act_XXXXXXXXX
//
// Transportes disponibles:
//   StreamableHTTP (Claude Code CLI): POST/GET/DELETE /mcp/ghl  |  /mcp/meta
//   SSE (Claude Desktop):             GET /mcp/ghl/sse          |  /mcp/meta/sse
//                                     POST /mcp/ghl/messages    |  /mcp/meta/messages

import 'dotenv/config';
import express from 'express';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer as createGHLServer } from '../mcp/ghl/index.js';
import { createServer as createMetaServer } from '../mcp/meta/index.js';

const app = express();
app.use(express.json());

const PORT  = process.env.MCP_PORT || 3001;
const TOKEN = process.env.REMI_MCP_TOKEN;

// ─── Auth ─────────────────────────────────────────────────────
function auth(req, res, next) {
  if (!TOKEN) return next();
  const bearer = (req.headers.authorization || '').replace('Bearer ', '');
  if (bearer !== TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── StreamableHTTP — sesiones ────────────────────────────────
const ghlSessions  = new Map();
const metaSessions = new Map();

async function handleMcp(req, res, sessions, createFn) {
  const sessionId = req.headers['mcp-session-id'];
  let transport = sessionId ? sessions.get(sessionId) : null;

  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => sessions.set(id, transport),
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    const server = createFn();
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
}

// ─── StreamableHTTP — GHL ─────────────────────────────────────
app.post('/mcp/ghl', auth, (req, res) => handleMcp(req, res, ghlSessions, createGHLServer));

app.get('/mcp/ghl', auth, (req, res) => {
  const t = ghlSessions.get(req.headers['mcp-session-id']);
  return t ? t.handleRequest(req, res) : res.status(404).json({ error: 'Session not found' });
});

app.delete('/mcp/ghl', auth, (req, res) => {
  ghlSessions.delete(req.headers['mcp-session-id']);
  res.json({ ok: true });
});

// ─── StreamableHTTP — Meta Ads ────────────────────────────────
app.post('/mcp/meta', auth, (req, res) => handleMcp(req, res, metaSessions, createMetaServer));

app.get('/mcp/meta', auth, (req, res) => {
  const t = metaSessions.get(req.headers['mcp-session-id']);
  return t ? t.handleRequest(req, res) : res.status(404).json({ error: 'Session not found' });
});

app.delete('/mcp/meta', auth, (req, res) => {
  metaSessions.delete(req.headers['mcp-session-id']);
  res.json({ ok: true });
});

// ─── SSE — sesiones ───────────────────────────────────────────
const sseGhlSessions  = new Map();
const sseMetaSessions = new Map();

async function handleSseConnect(req, res, messagesPath, sessions, createFn) {
  const transport = new SSEServerTransport(messagesPath, res);
  sessions.set(transport.sessionId, transport);
  transport.onclose = () => sessions.delete(transport.sessionId);
  const server = createFn();
  await server.connect(transport);
}

async function handleSseMessage(req, res, sessions) {
  const sessionId = req.query.sessionId;
  const transport = sessions.get(sessionId);
  if (!transport) return res.status(404).json({ error: 'Session not found' });
  await transport.handlePostMessage(req, res);
}

// ─── SSE — GHL ────────────────────────────────────────────────
app.get('/mcp/ghl/sse', auth, (req, res) =>
  handleSseConnect(req, res, '/mcp/ghl/messages', sseGhlSessions, createGHLServer));

app.post('/mcp/ghl/messages', auth, (req, res) =>
  handleSseMessage(req, res, sseGhlSessions));

// ─── SSE — Meta Ads ───────────────────────────────────────────
app.get('/mcp/meta/sse', auth, (req, res) =>
  handleSseConnect(req, res, '/mcp/meta/messages', sseMetaSessions, createMetaServer));

app.post('/mcp/meta/messages', auth, (req, res) =>
  handleSseMessage(req, res, sseMetaSessions));

// ─── Health ───────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    agent: 'Remi-MCP-Gateway',
    servers: ['ghl', 'meta'],
    transports: ['streamable-http', 'sse'],
    sessions: {
      ghl: ghlSessions.size + sseGhlSessions.size,
      meta: metaSessions.size + sseMetaSessions.size,
    },
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`🔌 Remi MCP Gateway — puerto ${PORT}`);
  console.log(`   StreamableHTTP → /mcp/ghl  |  /mcp/meta`);
  console.log(`   SSE           → /mcp/ghl/sse  |  /mcp/meta/sse`);
  console.log(`   Auth: ${TOKEN ? 'Bearer token activo ✅' : '⚠️  Sin token (modo dev)'}`);
});
