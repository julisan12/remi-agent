// src/whatsapp.js — WhatsApp Business via Baileys
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from 'baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import Anthropic from '@anthropic-ai/sdk';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const SESSION_PATH = process.env.WA_SESSION_PATH || '/app/wa_session';
const TIMERS_FILE = path.join(SESSION_PATH, 'pending_timers.json');

// Webhook de escalamiento (opcional — configura ESCALATION_WEBHOOK_URL en .env)
const ESCALATION_WEBHOOK_URL = process.env.ESCALATION_WEBHOOK_URL;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

let sock = null;
const lidToPhone = new Map();
let isConnected = false;
let qrImage = null;
let status = 'disconnected';

const conversations = new Map();

// ─── TIMERS PERSISTENTES ─────────────────────────────────────

async function saveTimer(id, phone, message, fireAt) {
  let timers = await loadTimers();
  timers[id] = { phone, message, fireAt };
  await writeFile(TIMERS_FILE, JSON.stringify(timers, null, 2));
}

async function removeTimer(id) {
  let timers = await loadTimers();
  delete timers[id];
  await writeFile(TIMERS_FILE, JSON.stringify(timers, null, 2));
}

async function loadTimers() {
  try {
    if (!existsSync(TIMERS_FILE)) return {};
    const data = await readFile(TIMERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch { return {}; }
}

function scheduleTimer(id, phone, message, delayMs) {
  setTimeout(async () => {
    try {
      await sendWhatsAppMessage(phone, message);
      await removeTimer(id);
      console.log(`⏰ Timer ejecutado → ${phone}: ${message}`);
    } catch (err) {
      console.error(`❌ Error en timer ${id}:`, err.message);
    }
  }, delayMs);
}

export async function restoreTimers() {
  const timers = await loadTimers();
  const now = Date.now();
  let restored = 0;
  for (const [id, timer] of Object.entries(timers)) {
    const remaining = timer.fireAt - now;
    if (remaining <= 0) {
      scheduleTimer(id, timer.phone, timer.message, 0);
    } else {
      scheduleTimer(id, timer.phone, timer.message, remaining);
    }
    restored++;
  }
  if (restored > 0) console.log(`⏰ ${restored} timer(s) restaurado(s) desde disco`);
}

const conversationMode = new Map();

// ─── DETECCIÓN DE MODO ────────────────────────────────────────

function detectMode(jid, message) {
  if (conversationMode.get(jid) === 'team') return 'team';

  const lower = message.toLowerCase();
  const isTeam =
    lower.includes('dealer') ||
    lower.includes('soy del equipo') ||
    lower.includes('equipo de trabajo') ||
    lower.includes('soy parte del equipo') ||
    lower.includes('somos del equipo');

  if (isTeam) {
    conversationMode.set(jid, 'team');
    return 'team';
  }

  conversationMode.set(jid, 'client');
  return 'client';
}

// ─── SYSTEM PROMPTS ───────────────────────────────────────────

const SYSTEM_PROMPT_CLIENT = `Eres el asistente de soporte de [COMPANY_NAME] en WhatsApp.

IDENTIDAD: No reveles que eres un bot o IA. Eres el equipo de soporte.
Tono: profesional, cálido, humano. Español neutro. Frases cortas. Emojis moderados (máx 2-3).
Máximo 4-5 líneas por respuesta.

--- INFORMACIÓN ---
[Configura aquí la información de tu empresa y productos]

--- PROCESO ---
1. Interpreta la intención real del mensaje
2. Responde: contexto breve → solución → acción concreta
3. Si no sabes → di que verificas, NO inventes

ESCALAR con [ESCALAR] cuando:
- Problema sin resolver que requiere decisión humana
- Posible fraude
- Frustración severa
- Excepciones a política

PROHIBICIONES:
- No revelar que eres IA o bot
- No inventar información
- No compartir datos de otros usuarios`;

const SYSTEM_PROMPT_TEAM = `Eres Dealer, agente de inteligencia operativa.

MODO: Equipo interno. Técnico, directo, resolutivo.

CAPACIDADES:
- Enviar mensajes de WhatsApp (inmediato o programado)
- Consultar y actualizar CRM (GHL)
- Revisar métricas de Meta Ads
- Enviar mensajes en Slack

── ENVIAR MENSAJE INMEDIATO ──
Formato: [WA:+número] texto del mensaje

── ENVIAR MENSAJE PROGRAMADO ──
Formato: [WA-TIMER:+número|minutos] texto`;

// ─── PROCESAR MENSAJE CON IA ─────────────────────────────────

async function processWithAI(jid, userMessage, senderName) {
  if (!conversations.has(jid)) {
    conversations.set(jid, []);
  }

  const mode = detectMode(jid, userMessage);
  const phone = jid.replace('@s.whatsapp.net', '');
  const teamContext = mode === 'team'
    ? `\n\nCONTEXTO: El número de quien te escribe es +${phone} (${senderName}).`
    : '';
  const systemPrompt = (mode === 'team' ? SYSTEM_PROMPT_TEAM : SYSTEM_PROMPT_CLIENT) + teamContext;

  const history = conversations.get(jid);
  history.push({ role: 'user', content: userMessage });

  if (history.length > 10) history.splice(0, history.length - 10);

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: mode === 'team' ? 500 : 300,
    system: systemPrompt,
    messages: history,
  });

  const reply = response.content[0].text;
  history.push({ role: 'assistant', content: reply });

  console.log(`💬 Modo: ${mode} | De: ${senderName}`);
  return reply;
}

// ─── ESCALAR COMPROBANTE ──────────────────────────────────────

function resolvePhone(jid) {
  if (jid.endsWith('@lid')) {
    const mapped = lidToPhone.get(jid);
    if (mapped) return mapped.replace(/\D/g, '');
    return null;
  }
  return jid.replace(/@.*$/, '');
}

async function escalatePaymentProof(jid, senderName, mediaType, caption) {
  const phone = resolvePhone(jid);
  const payload = {
    type: 'payment_proof',
    contact: senderName,
    phone: phone ? `+${phone}` : jid,
    mediaType,
    caption: caption || '',
    timestamp: new Date().toISOString(),
  };
  console.log('💳 ESCALAMIENTO — Comprobante recibido:', JSON.stringify(payload));
  if (ESCALATION_WEBHOOK_URL) {
    await fetch(ESCALATION_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(err => console.error('❌ Error enviando escalamiento:', err.message));
  }
}

// ─── ESCALAR ─────────────────────────────────────────────────

async function escalate(jid, senderName, message, aiResponse) {
  const phone = resolvePhone(jid) || jid;
  const payload = {
    type: 'escalation',
    contact: senderName,
    phone: `+${phone}`,
    message,
    aiResponse,
    timestamp: new Date().toISOString(),
  };
  console.log('🔺 ESCALAMIENTO — Requiere atención humana:', JSON.stringify(payload));
  if (ESCALATION_WEBHOOK_URL) {
    await fetch(ESCALATION_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(err => console.error('❌ Error enviando escalamiento:', err.message));
  }
}

// ─── MANEJAR MENSAJES ENTRANTES ──────────────────────────────

async function handleIncomingMessage(msg) {
  const jid = msg.key.remoteJid;
  const isGroup = jid?.endsWith('@g.us');
  const fromMe = msg.key.fromMe;

  if (isGroup || fromMe || !jid) return;

  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.buttonsResponseMessage?.selectedDisplayText ||
    null;

  const isImage    = !!msg.message?.imageMessage;
  const isDocument = !!msg.message?.documentMessage;
  const isVideo    = !!msg.message?.videoMessage;

  if (isImage || isDocument || isVideo) {
    const senderName = msg.pushName || jid.replace('@s.whatsapp.net', '');
    const mediaType  = isImage ? 'imagen 🖼️' : isDocument ? 'documento 📄' : 'video 🎬';
    const caption    = msg.message?.imageMessage?.caption ||
                       msg.message?.documentMessage?.caption ||
                       msg.message?.videoMessage?.caption || '';

    await sock.readMessages([msg.key]);
    await sendMessage(jid,
      `✅ Recibí tu ${mediaType}${caption ? ` con nota: "${caption}"` : ''}.\n\nUn miembro del equipo lo revisará pronto. ⏳`
    );

    try {
      await escalatePaymentProof(jid, senderName, mediaType, caption);
    } catch (err) {
      console.error(`❌ Error enviando escalamiento:`, err.message);
    }
    return;
  }

  if (!text) return;

  const senderName = msg.pushName || jid.replace('@s.whatsapp.net', '');
  console.log(`📨 Mensaje de ${senderName}: ${text}`);

  try {
    await sock.readMessages([msg.key]);
    await sock.sendPresenceUpdate('composing', jid);

    const reply = await processWithAI(jid, text, senderName);

    await sock.sendPresenceUpdate('paused', jid);

    const timerMatch = reply.match(/\[WA-TIMER:\s*(\+?[\d\s]+?)\s*\|\s*(\d+)\s*\]\s*([\s\S]+?)(?=\[WA|$)/);
    if (timerMatch) {
      const targetPhone = timerMatch[1];
      const delayMinutes = parseInt(timerMatch[2]);
      const targetMessage = timerMatch[3].trim();
      const cleanReply = reply.replace(/\[WA-TIMER:[^\]]+\][\s\S]+/, '').trim();
      const delayMs = delayMinutes * 60 * 1000;
      const fireAt = Date.now() + delayMs;
      const timerId = `${Date.now()}-${targetPhone}`;

      await saveTimer(timerId, targetPhone, targetMessage, fireAt);
      scheduleTimer(timerId, targetPhone, targetMessage, delayMs);

      const sendTime = new Date(fireAt)
        .toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' });

      await sendMessage(jid, `${cleanReply ? cleanReply + '\n\n' : ''}⏰ Programado para las ${sendTime} (en ${delayMinutes} min):\n"${targetMessage}"`);
      return;
    }

    const waCommandMatch = reply.match(/\[WA:(\+?\d+)\]\s*([\s\S]+?)(?=\[WA:|$)/);
    if (waCommandMatch) {
      const targetPhone = waCommandMatch[1];
      const targetMessage = waCommandMatch[2].trim();
      const cleanReply = reply.replace(/\[WA:\+?\d+\][\s\S]+/, '').trim();

      try {
        await sendWhatsAppMessage(targetPhone, targetMessage);
        await sendMessage(jid, `${cleanReply ? cleanReply + '\n\n' : ''}✅ Mensaje enviado a ${targetPhone}:\n"${targetMessage}"`);
      } catch (err) {
        await sendMessage(jid, `❌ No pude enviar el mensaje a ${targetPhone}: ${err.message}`);
      }
      return;
    }

    if (reply.includes('[ESCALAR]')) {
      const cleanReply = reply.replace('[ESCALAR]', '').trim();
      await sendMessage(jid, cleanReply);
      await escalate(jid, senderName, text, cleanReply);
      console.log(`🔺 Escalado: ${senderName}`);
    } else {
      await sendMessage(jid, reply);
    }

    console.log(`✅ Respondido a ${senderName}`);
  } catch (err) {
    console.error(`❌ Error procesando mensaje de ${senderName}:`, err.message);
  }
}

// ─── ENVIAR MENSAJE ──────────────────────────────────────────

async function sendMessage(jid, text) {
  if (!isConnected || !sock) throw new Error('WhatsApp no conectado');
  await sock.sendMessage(jid, { text });
}

export async function sendWhatsAppMessage(phone, message) {
  const clean = phone.replace(/\D/g, '');
  const jid = `${clean}@s.whatsapp.net`;
  await sendMessage(jid, message);
  return { success: true, to: jid };
}

// ─── INICIALIZAR ─────────────────────────────────────────────

export async function initWhatsApp() {
  try { await mkdir(SESSION_PATH, { recursive: true }); } catch {}

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Dealer', 'Chrome', '1.0.0'],
    logger: {
      level: 'silent',
      trace: ()=>{}, debug: ()=>{}, info: ()=>{}, warn: ()=>{},
      error: ()=>{}, fatal: ()=>{}, child: ()=>({
        level: 'silent', trace: ()=>{}, debug: ()=>{}, info: ()=>{},
        warn: ()=>{}, error: ()=>{}, fatal: ()=>{}, child: ()=>({})
      })
    },
  });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      status = 'waiting_qr';
      qrImage = await QRCode.toDataURL(qr);
      console.log('📱 QR listo → /wa/qr');
    }
    if (connection === 'open') {
      isConnected = true;
      qrImage = null;
      status = 'connected';
      console.log('✅ WhatsApp Business conectado');
    }
    if (connection === 'close') {
      isConnected = false;
      status = 'disconnected';
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(`🔄 Reconectando... (código: ${code})`);
      setTimeout(() => initWhatsApp(), shouldReconnect ? 3000 : 5000);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  const mapContacts = (contacts) => {
    for (const c of contacts) {
      if (c.lid && c.id && !c.id.endsWith('@lid')) {
        const phone = c.id.replace('@s.whatsapp.net', '');
        lidToPhone.set(c.lid, phone);
      }
      if (c.id?.endsWith('@lid') && c.notify) {
        lidToPhone.set(c.id, c.notify);
      }
    }
  };
  sock.ev.on('contacts.upsert', mapContacts);
  sock.ev.on('contacts.update', mapContacts);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      await handleIncomingMessage(msg);
    }
  });
}

// ─── RUTAS EXPRESS ───────────────────────────────────────────

export function waRoutes(app) {
  app.get('/wa/qr', (req, res) => {
    if (status === 'connected') {
      return res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0a;color:#fff">
          <h2>✅ WhatsApp conectado</h2>
          <p style="color:#4ade80">Dealer está activo.</p>
        </body></html>`);
    }
    if (!qrImage) {
      return res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0a;color:#fff">
          <h2>⏳ Generando QR...</h2>
          <script>setTimeout(()=>location.reload(),5000)</script>
        </body></html>`);
    }
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0a;color:#fff">
        <h2>📱 Escanea con WhatsApp Business</h2>
        <img src="${qrImage}" style="width:280px;border:8px solid white;border-radius:12px;margin:20px 0"/>
        <script>setTimeout(()=>location.reload(),15000)</script>
      </body></html>`);
  });

  app.get('/wa/status', (req, res) => {
    res.json({ status, connected: isConnected });
  });

  app.post('/wa/send', async (req, res) => {
    if (req.headers['x-dealer-token'] !== process.env.DEALER_SECRET_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'Se requiere phone y message' });
    try {
      const result = await sendWhatsAppMessage(phone, message);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
