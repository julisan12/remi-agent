// src/server.js — Servidor principal de Remi en Railway
import dotenv from 'dotenv';
import { resolve } from 'path';
// En Railway las vars vienen del dashboard; local las carga desde config/.env
dotenv.config({ path: resolve(process.cwd(), 'config/.env') });
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer as createGHLServer } from '../mcp/ghl/index.js';
import { createServer as createMetaServer } from '../mcp/meta/index.js';

// ─── Capturar errores globales (evitar crash del proceso) ─────
process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection:', reason);
});
import { initScheduler } from './scheduler.js';
import { recordHeartbeat, getHeartbeatInfo } from './lib/heartbeat.js';
import { runJobSearch } from './tasks/jobSearch.js';
import { initWhatsApp, waRoutes, restoreTimers } from './whatsapp.js';
import { handleAccesoEntregado } from './tasks/notionSync.js';
import desktopRoutes from './routes/desktop.js';
import webRoutes from './routes/web.js';
import credsRoutes from './routes/creds.js';
import oauthRoutes from './routes/oauth.js';
import { registerMeetingWS } from './meeting/websocket-handler.js';
import transcribeRoute from './meeting/transcribe-route.js';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());

// ─── Interfaz web (archivos estáticos) ────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, '../public');
app.use(express.static(PUBLIC_DIR));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'login.html')));

// ─── API Web (auth, config, logs, usuarios) ───────────────────────────────────
app.use('/api', webRoutes);

// ─── Credenciales por usuario ─────────────────────────────────────────────────
app.use('/api/creds', credsRoutes);
app.use('/api/oauth', oauthRoutes);

// ─── Desktop App API ──────────────────────────────────────────────────────────
app.use('/api/desktop', desktopRoutes);
app.use('/api/desktop', transcribeRoute);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', agent: 'Remi', version: '2.0.0', timestamp: new Date().toISOString() });
});

// ─── Heartbeat — coordina primary (local) vs fallback (Railway) ───────────────
app.post('/heartbeat/sendflow', (req, res) => {
  if (req.headers['x-remi-token'] !== process.env.REMI_SECRET_TOKEN)
    return res.status(401).json({ error: 'Unauthorized' });
  recordHeartbeat('sendflow');
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.get('/heartbeat/sendflow', (req, res) => {
  res.json(getHeartbeatInfo('sendflow'));
});

// ─── Trigger manual (protegido por token) ─────────────────────────────────────
app.post('/run/:task', async (req, res) => {
  const token = req.headers['x-remi-token'];
  if (token !== process.env.REMI_SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { task } = req.params;

  if (task === 'jobs') {
    res.json({ status: 'accepted', task: 'jobSearch', message: 'Iniciando búsqueda de empleos...' });
    runJobSearch().catch((err) => console.error('Error en trigger manual:', err));
    return;
  }

  if (task === 'sendflow') {
    res.json({ status: 'accepted', task: 'sendflowMonitor', message: 'Iniciando monitor Sendflow...' });
    import('./tasks/sendflowMonitor.js')
      .then(({ runSendflowMonitor }) => runSendflowMonitor())
      .catch((err) => console.error('Error en sendflow trigger:', err));
    return;
  }

  if (task === 'precio') {
    const dryRun = req.body?.dryRun !== false; // dry run por defecto
    res.json({ status: 'accepted', task: 'actualizarPrecio', dryRun, message: `Actualizando precio Bs (BCV)${dryRun ? ' — DRY RUN' : ''}...` });
    import('./tasks/actualizarPrecio.js')
      .then(({ runActualizarPrecio }) => runActualizarPrecio({ dryRun }))
      .catch((err) => console.error('Error en precio trigger:', err));
    return;
  }

  res.status(404).json({ error: `Tarea '${task}' no encontrada` });
});

// ─── Webhook GHL → Notion (Acceso Entregado) ─────────────────────────────────
app.post('/webhook/ghl-acceso', async (req, res) => {
  // Responder inmediatamente para que GHL no haga retry
  res.json({ received: true });

  try {
    const result = await handleAccesoEntregado(req.body);
    if (result.skipped) {
      console.log(`⏭️  webhook/ghl-acceso ignorado — stage: ${result.stageId}`);
    } else if (result.success) {
      console.log(`✅ webhook/ghl-acceso procesado: ${result.nombre} | Gen: ${result.gen}`);
    } else {
      console.error(`❌ webhook/ghl-acceso error:`, result.error);
    }
  } catch (err) {
    console.error('❌ webhook/ghl-acceso exception:', err.message);
  }
});

// ─── Voice Mode — info para el dashboard ─────────────────────────────────────
app.post('/api/voice/start', (req, res) => {
  const token = req.headers['x-remi-token'];
  if (token !== process.env.REMI_SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { tema = 'Reunión de equipo' } = req.body;
  // El servidor de voz corre LOCAL en la máquina del usuario — Railway
  // solo informa la URL y el comando para iniciar
  res.json({
    ok: true,
    voice_url: 'https://localhost:8998',
    instrucciones: [
      'conda activate remi-voice',
      `python voice/launcher.py "${tema}"`,
      'Abre https://localhost:8998 en el navegador',
    ],
    tema,
    modelo: 'Moshi 7B + PersonaPlex NATM1',
  });
});

// ─── MCP Gateway (GHL + Meta) ─────────────────────────────────────────────────
const MCP_TOKEN = process.env.REMI_MCP_TOKEN;

function mcpAuth(req, res, next) {
  if (!MCP_TOKEN) return next();
  const bearer = (req.headers.authorization || '').replace('Bearer ', '');
  if (bearer !== MCP_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// StreamableHTTP sessions
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
    transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); };
    await createFn().connect(transport);
  }
  await transport.handleRequest(req, res, req.body);
}

app.post('/mcp/ghl', mcpAuth, (req, res) => handleMcp(req, res, ghlSessions, createGHLServer));
app.get('/mcp/ghl',  mcpAuth, (req, res) => { const t = ghlSessions.get(req.headers['mcp-session-id']); return t ? t.handleRequest(req, res) : res.status(404).json({ error: 'Session not found' }); });
app.delete('/mcp/ghl', mcpAuth, (req, res) => { ghlSessions.delete(req.headers['mcp-session-id']); res.json({ ok: true }); });

app.post('/mcp/meta', mcpAuth, (req, res) => handleMcp(req, res, metaSessions, createMetaServer));
app.get('/mcp/meta',  mcpAuth, (req, res) => { const t = metaSessions.get(req.headers['mcp-session-id']); return t ? t.handleRequest(req, res) : res.status(404).json({ error: 'Session not found' }); });
app.delete('/mcp/meta', mcpAuth, (req, res) => { metaSessions.delete(req.headers['mcp-session-id']); res.json({ ok: true }); });

// SSE sessions
const sseGhlSessions  = new Map();
const sseMetaSessions = new Map();

app.get('/mcp/ghl/sse', mcpAuth, async (req, res) => {
  const t = new SSEServerTransport('/mcp/ghl/messages', res);
  sseGhlSessions.set(t.sessionId, t);
  t.onclose = () => sseGhlSessions.delete(t.sessionId);
  await createGHLServer().connect(t);
});
app.post('/mcp/ghl/messages', mcpAuth, async (req, res) => {
  const t = sseGhlSessions.get(req.query.sessionId);
  if (!t) return res.status(404).json({ error: 'Session not found' });
  await t.handlePostMessage(req, res);
});

app.get('/mcp/meta/sse', mcpAuth, async (req, res) => {
  const t = new SSEServerTransport('/mcp/meta/messages', res);
  sseMetaSessions.set(t.sessionId, t);
  t.onclose = () => sseMetaSessions.delete(t.sessionId);
  await createMetaServer().connect(t);
});
app.post('/mcp/meta/messages', mcpAuth, async (req, res) => {
  const t = sseMetaSessions.get(req.query.sessionId);
  if (!t) return res.status(404).json({ error: 'Session not found' });
  await t.handlePostMessage(req, res);
});

// ─── Rutas WhatsApp ───────────────────────────────────────────────────────────
waRoutes(app);

// ─── Arranque ─────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`\n🤖 Remi v2.0 arriba en puerto ${PORT}`);
  console.log(`📍 Tu Academia — Railway`);
  console.log(`🕐 ${new Date().toLocaleString('es-CO', { timeZone: 'America/Caracas' })}\n`);
  initScheduler();
  initWhatsApp().catch(err => console.error('Error iniciando WhatsApp:', err));
  restoreTimers().catch(err => console.error('Error restaurando timers:', err));
});
registerMeetingWS(server);
