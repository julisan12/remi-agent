// src/whatsapp.js — WhatsApp Business via Baileys para Railway
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
import { WebClient } from '@slack/web-api';

const SESSION_PATH = process.env.WA_SESSION_PATH || '/app/wa_session';
const TIMERS_FILE = path.join(SESSION_PATH, 'pending_timers.json');
const SLACK_OPERADOR = process.env.SLACK_OPERADOR_USER_ID;
const SLACK_ALERTAS_CHANNEL = 'C0AMZ14JLJJ';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

let sock = null;
const lidToPhone = new Map(); // @lid → número real
let isConnected = false;
let qrImage = null;
let status = 'disconnected';

// Historial de conversaciones en memoria (por JID)
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
      // Ya venció — enviar inmediatamente
      scheduleTimer(id, timer.phone, timer.message, 0);
    } else {
      scheduleTimer(id, timer.phone, timer.message, remaining);
    }
    restored++;
  }
  if (restored > 0) console.log(`⏰ ${restored} timer(s) restaurado(s) desde disco`);
}

// Registro de modo por conversación: 'client' | 'team'
const conversationMode = new Map();

// ─── DETECCIÓN DE MODO ────────────────────────────────────────

function detectMode(jid, message) {
  // Si ya identificamos al usuario como equipo, se mantiene
  if (conversationMode.get(jid) === 'team') return 'team';

  const lower = message.toLowerCase();
  const isTeam =
    lower.includes('remi') ||
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

const SYSTEM_PROMPT_CLIENT = `Eres el asistente de soporte de Tu Academia en WhatsApp.

IDENTIDAD: No reveles que eres un bot, una IA ni que te llamas Remi. Eres el equipo de soporte de Tu Academia.
Tono: profesional, cálido, humano. Español neutro. Frases cortas. Emojis moderados (máx 2-3).
Máximo 4-5 líneas por respuesta. Si necesitas más, divide en partes.
Interpreta mensajes con errores ortográficos, lenguaje informal o indirecto — responde a la intención real.

--- INFORMACIÓN DEL PROGRAMA ---

Tu Academia forma para trabajo remoto real: ventas digitales, operaciones, marketing e IA aplicada.
Proceso de ingreso: 3 sesiones filtro gratuitas → evaluación → programa completo.
No garantizamos empleo ni ingresos. Nadie puede hacerlo honestamente.
Tiempo requerido: 8-12 horas semanales.

RUTAS: Ventas (Setter→Closer) | Operaciones (AV→Ops Digitales) | Marketing | IA Aplicada.

--- DATOS CLAVE ---
- Plataforma: https://tu-plataforma.com (usar Chrome)
- App Android: https://tu-plataforma.com/app
- App iOS: https://tu-plataforma.com/app
- Bolsa empleos (solo certificados): https://tu-plataforma.com
- Correo académico: soporte@tu-dominio.com
- Correo soporte: soporte@tu-dominio.com
- Examen: cada 45 días, fecha en comunidad de generación
- Bono 600/15: incluido en inscripción, subcuenta GHL por 12 meses
- Solicitud GHL: correo a soporte@tu-dominio.com | Asunto: "Solicitud de acceso a GoHighLevel" | Incluir: Nombre, Apellido, Teléfono, Correo, País/ciudad, Código postal
- Material de apoyo: plataforma → módulo → panel derecho → descargar PDF
- Grabaciones: Certificación Internacional → Sesiones en Vivo

--- MANEJO DE OBJECIONES ---

"No tengo tiempo" → "Está diseñado para 8-12h semanales, muchos avanzan con bloques de 25 min. ¿Cuántas horas podrías dedicar si sabes que te va a retornar?"

"No tengo dinero" → "¿Cuánto te cuesta NO tener estas habilidades? Tenemos opciones de pago. ¿Te cuento cómo funciona?"

"No sé si es para mí" → "Por eso existen las 3 sesiones filtro gratuitas. Sin compromiso. Si al final no es para ti, perfecto. ¿Te registro?"

"Ya probé cursos y no funcionaron" → "Lo diferente aquí: cada semana entregas algo y recibes feedback real. No es ver videos, es hacer y mejorar. ¿Qué no funcionó antes?"

"Déjame pensarlo" → "¿Hay algo específico que quieras aclarar ahora? Te ahorra tiempo."

--- PROCESO ---
1. Interpreta la intención real del mensaje
2. Responde: contexto breve → solución → acción concreta
3. Si no sabes → di que verificas, NO inventes

ESCALAR con [ESCALAR] cuando:
- Problema de pago sin resolver tras pedir comprobante
- Posible fraude o estafa
- Frustración severa o amenaza de chargeback
- Excepción a política (descuento, reembolso, prórroga)
- Pregunta fuera de tu alcance

PROHIBICIONES:
- No revelar que eres IA o bot ni decir tu nombre
- No prometer empleo ni ingresos
- No inventar información
- No compartir datos de otros usuarios`;

const SYSTEM_PROMPT_TEAM = `Eres Remi, agente de inteligencia operativa de Tu Academia.

MODO: Equipo interno. Técnico, directo, métrico y resolutivo. Sin relleno. Sin emojis innecesarios.

CAPACIDADES DISPONIBLES:
- Enviar mensajes de WhatsApp a cualquier número (inmediato o programado)
- Consultar y actualizar GHL (CRM)
- Revisar métricas de Meta Ads
- Leer/escribir Google Sheets
- Enviar mensajes en Slack

── ENVIAR MENSAJE INMEDIATO ──
Formato: [WA:+número] texto del mensaje
Ejemplo: [WA:+573001234567] Hola Juan 👋 Recuerda tu sesión mañana a las 3pm.

── ENVIAR MENSAJE PROGRAMADO (con retardo) ──
Formato EXACTO (no cambies nada): [WA-TIMER:+número|minutos] texto
- El número es el destinatario con código de país
- minutos es un número entero
- El texto va DESPUÉS del corchete de cierre, en la misma línea

Ejemplos EXACTOS que debes replicar:
- "envíame CLASE en 2 min" → [WA-TIMER:+573001234567|2] CLASE
- "recuérdale a María en 1 hora" → [WA-TIMER:+573009876543|60] Hola María, recuerda tu sesión
- "en 30 min mándame el reporte" → [WA-TIMER:+573001234567|30] Reporte listo ✅

CRÍTICO: Si te piden enviarte algo A TI MISMO, usa el número de quien escribe (te lo doy en el contexto).
El comando debe estar en su propia línea, sin texto adicional antes del corchete.

Eres el mismo Remi del sistema principal: analítico, honesto, propositivo.`;

// ─── PROCESAR MENSAJE CON IA ─────────────────────────────────

async function processWithAI(jid, userMessage, senderName) {
  if (!conversations.has(jid)) {
    conversations.set(jid, []);
  }

  const mode = detectMode(jid, userMessage);
  const phone = jid.replace('@s.whatsapp.net', '');
  const teamContext = mode === 'team'
    ? `\n\nCONTEXTO DE ESTA CONVERSACIÓN: El número de quien te escribe ahora es +${phone} (${senderName}). Si te pide enviarse algo a sí mismo, usa ese número.`
    : '';
  const systemPrompt = (mode === 'team' ? SYSTEM_PROMPT_TEAM : SYSTEM_PROMPT_CLIENT) + teamContext;

  const history = conversations.get(jid);
  history.push({ role: 'user', content: userMessage });

  // Mantener máx 10 mensajes de historial
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
  console.log(`🤖 Reply raw: ${reply.substring(0, 200)}`);
  return reply;
}

// ─── ESCALAR COMPROBANTE DE PAGO ─────────────────────────────
function resolvePhone(jid) {
  if (jid.endsWith('@lid')) {
    // Buscar en el mapa construido desde contacts.upsert
    const mapped = lidToPhone.get(jid);
    if (mapped) return mapped.replace(/\D/g, ''); // solo dígitos
    return null;
  }
  return jid.replace(/@.*$/, '');
}

async function escalatePaymentProof(jid, senderName, mediaType, caption) {
  const phone    = resolvePhone(jid);
  const phoneStr = phone ? `+${phone}` : `_No disponible — busca en WA por nombre_`;
  const jidRef   = phone ? '' : `\n*🔑 Referencia WA:* \`${jid}\``;

  await slack.chat.postMessage({
    channel: SLACK_ALERTAS_CHANNEL,
    text: `💳 COMPROBANTE DE PAGO recibido <@${SLACK_OPERADOR}>`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '💳 Comprobante de pago — Revisión requerida' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*👤 Nombre:*\n${senderName}` },
          { type: 'mrkdwn', text: `*📞 Número:*\n${phoneStr}` },
        ],
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*📎 Tipo de archivo:*\n${mediaType}` },
          { type: 'mrkdwn', text: `*📝 Nota del contacto:*\n${caption || '(sin nota)'}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⚡ Acción requerida:* Abre WhatsApp y busca a *${senderName}* para ver el comprobante.${jidRef}\n<@${SLACK_OPERADOR}> por favor valida este caso.`,
        },
      },
      { type: 'divider' },
    ],
  });
}

// ─── ESCALAR A SLACK ─────────────────────────────────────────

async function escalateToSlack(jid, senderName, message, aiResponse) {
  const phone = resolvePhone(jid) || jid;
  await slack.chat.postMessage({
    channel: SLACK_ALERTAS_CHANNEL,
    text: `🔺 ESCALAMIENTO WhatsApp <@${SLACK_OPERADOR}>`,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🔺 Escalamiento WhatsApp — Acción requerida' },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*👤 Contacto:*\n${senderName}` },
          { type: 'mrkdwn', text: `*📞 Número:*\n+${phone}` },
        ],
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*💬 Mensaje recibido:*\n${message}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*🤖 Remi respondió:*\n${aiResponse}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*❓ Motivo:* Requiere decisión humana\n*⏱️ Urgencia:* Alta\n\n<@${SLACK_OPERADOR}> por favor atiende este caso.` },
      },
      { type: 'divider' },
    ],
  });
}

// ─── MANEJAR MENSAJES ENTRANTES ──────────────────────────────

async function handleIncomingMessage(msg) {
  const jid = msg.key.remoteJid;
  const isGroup = jid?.endsWith('@g.us');
  const fromMe = msg.key.fromMe;

  // Ignorar grupos, mensajes propios, estados, newsletters y broadcasts
  if (!jid)                          return;
  if (fromMe)                        return;
  if (isGroup)                       return;
  if (jid === 'status@broadcast')    return; // estados de contactos
  if (jid.endsWith('@newsletter'))   return; // canales de WhatsApp
  if (jid.endsWith('@broadcast'))    return; // listas de difusión
  if (msg.key.remoteJid === 'status@broadcast') return;

  const text =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.buttonsResponseMessage?.selectedDisplayText ||
    null;

  // ─── Detectar imagen/documento (posible comprobante de pago) ──────────
  const isImage    = !!msg.message?.imageMessage;
  const isDocument = !!msg.message?.documentMessage;
  const isVideo    = !!msg.message?.videoMessage;

  if (isImage || isDocument || isVideo) {
    const senderName = msg.pushName || jid.replace('@s.whatsapp.net', '');
    const mediaType  = isImage ? 'imagen 🖼️' : isDocument ? 'documento 📄' : 'video 🎬';
    const caption    = msg.message?.imageMessage?.caption ||
                       msg.message?.documentMessage?.caption ||
                       msg.message?.videoMessage?.caption || '';

    console.log(`📎 Archivo recibido de ${senderName} (${mediaType})${caption ? ': ' + caption : ''}`);

    // Responder al contacto confirmando recepción
    await sock.readMessages([msg.key]);
    await sendMessage(jid,
      `✅ Recibí tu ${mediaType}${caption ? ` con nota: "${caption}"` : ''}.\n\n` +
      `Un miembro del equipo lo revisará pronto y te confirmará. ⏳`
    );

    // Escalar a Slack con contexto de comprobante
    try {
      await escalatePaymentProof(jid, senderName, mediaType, caption);
      console.log(`✅ Escalamiento Slack enviado para ${senderName}`);
    } catch (slackErr) {
      console.error(`❌ Error enviando escalamiento a Slack:`, slackErr?.data || slackErr?.message || slackErr);
    }
    return;
  }

  if (!text) return;

  const senderName = msg.pushName || jid.replace('@s.whatsapp.net', '');
  console.log(`📨 Mensaje de ${senderName}: ${text}`);

  try {
    // Marcar como leído
    await sock.readMessages([msg.key]);

    // Simular "escribiendo..."
    await sock.sendPresenceUpdate('composing', jid);

    // Procesar con IA
    const reply = await processWithAI(jid, text, senderName);

    // Detener "escribiendo"
    await sock.sendPresenceUpdate('paused', jid);

    // Si la IA quiere enviar un mensaje programado [WA-TIMER:+número|minutos]
    const timerMatch = reply.match(/\[WA-TIMER:\s*(\+?[\d\s]+?)\s*\|\s*(\d+)\s*\]\s*([\s\S]+?)(?=\[WA|$)/);
    if (timerMatch) {
      const targetPhone = timerMatch[1];
      const delayMinutes = parseInt(timerMatch[2]);
      const targetMessage = timerMatch[3].trim();
      const cleanReply = reply.replace(/\[WA-TIMER:[^\]]+\][\s\S]+/, '').trim();
      const delayMs = delayMinutes * 60 * 1000;
      const fireAt = Date.now() + delayMs;
      const timerId = `${Date.now()}-${targetPhone}`;

      // Guardar en disco y programar
      await saveTimer(timerId, targetPhone, targetMessage, fireAt);
      scheduleTimer(timerId, targetPhone, targetMessage, delayMs);

      const sendTime = new Date(fireAt)
        .toLocaleTimeString('es-CO', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit' });

      await sendMessage(jid, `${cleanReply ? cleanReply + '\n\n' : ''}⏰ Guardado y programado para las ${sendTime} (en ${delayMinutes} min):\n"${targetMessage}"`);
      return;
    }

    // Si la IA quiere enviar un mensaje a otro número (modo equipo)
    const waCommandMatch = reply.match(/\[WA:(\+?\d+)\]\s*([\s\S]+?)(?=\[WA:|$)/);
    if (waCommandMatch) {
      const targetPhone = waCommandMatch[1];
      const targetMessage = waCommandMatch[2].trim();
      const cleanReply = reply.replace(/\[WA:\+?\d+\][\s\S]+/, '').trim();

      try {
        await sendWhatsAppMessage(targetPhone, targetMessage);
        const confirmation = `${cleanReply ? cleanReply + '\n\n' : ''}✅ Mensaje enviado a ${targetPhone}:\n"${targetMessage}"`;
        await sendMessage(jid, confirmation);
      } catch (err) {
        await sendMessage(jid, `❌ No pude enviar el mensaje a ${targetPhone}: ${err.message}`);
      }
      return;
    }

    // Si la IA decide escalar
    if (reply.includes('[ESCALAR]')) {
      const cleanReply = reply.replace('[ESCALAR]', '').trim();
      await sendMessage(jid, cleanReply);
      await escalateToSlack(jid, senderName, text, cleanReply);
      console.log(`🔺 Escalado a la operadora: ${senderName}`);
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
    browser: ['Remi', 'Chrome', '1.0.0'],
    logger: {
      level: 'silent',
      trace: ()=>{}, debug: ()=>{}, info: ()=>{}, warn: ()=>{},
      error: ()=>{}, fatal: ()=>{}, child: ()=>({
        level: 'silent', trace: ()=>{}, debug: ()=>{}, info: ()=>{},
        warn: ()=>{}, error: ()=>{}, fatal: ()=>{}, child: ()=>({})
      })
    },
  });

  // Conexión
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

  // Guardar credenciales
  sock.ev.on('creds.update', saveCreds);

  // ─── Mapa de contactos lid → número real ───────────────────
  const mapContacts = (contacts) => {
    for (const c of contacts) {
      // c.lid = '123@lid', c.id = '573001234567@s.whatsapp.net'
      if (c.lid && c.id && !c.id.endsWith('@lid')) {
        const phone = c.id.replace('@s.whatsapp.net', '');
        lidToPhone.set(c.lid, phone);
      }
      // También el caso inverso: id es @lid, phone en otro campo
      if (c.id?.endsWith('@lid') && c.notify) {
        lidToPhone.set(c.id, c.notify);
      }
    }
  };
  sock.ev.on('contacts.upsert', mapContacts);
  sock.ev.on('contacts.update', mapContacts);

  // Mensajes entrantes
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      await handleIncomingMessage(msg);
    }
  });
}

// ─── RUTAS EXPRESS ───────────────────────────────────────────

export function waRoutes(app) {
  // QR
  app.get('/wa/qr', (req, res) => {
    if (status === 'connected') {
      return res.send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0a0a0a;color:#fff">
          <h2>✅ WhatsApp Business conectado</h2>
          <p style="color:#4ade80">Remi está activo y recibiendo mensajes.</p>
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
        <p>Dispositivos vinculados → Vincular dispositivo</p>
        <img src="${qrImage}" style="width:280px;border:8px solid white;border-radius:12px;margin:20px 0"/>
        <p style="color:#888;font-size:13px">Se actualiza cada 15s</p>
        <script>setTimeout(()=>location.reload(),15000)</script>
      </body></html>`);
  });

  // Status
  app.get('/wa/status', (req, res) => {
    res.json({ status, connected: isConnected });
  });

  // Enviar mensaje manual (protegido)
  app.post('/wa/send', async (req, res) => {
    if (req.headers['x-remi-token'] !== process.env.REMI_SECRET_TOKEN) {
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
