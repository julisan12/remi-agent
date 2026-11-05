// src/lib/whatsapp.js
// Cliente WhatsApp singleton para el servidor web (Express)
// Comparte sesión con mcp/whatsapp pero corre en proceso separado (Railway)
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from 'baileys';
import { Boom } from '@hapi/boom';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SESSION_PATH = process.env.WA_SESSION_PATH || path.join(__dirname, '../../memory/wa_session');

let sock = null;
let isConnected = false;
let connectionAttempted = false;

export function isWAConnected() { return isConnected; }
export function getWASocket() { return sock; }

export function formatJid(phone) {
  const clean = phone.replace(/\D/g, '');
  return `${clean}@s.whatsapp.net`;
}

export async function initWhatsApp() {
  if (connectionAttempted) return;
  connectionAttempted = true;
  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const { version } = await fetchLatestBaileysVersion();
    sock = makeWASocket({ version, auth: state, printQRInTerminal: false, browser: ['Remi-Web', 'Chrome', '1.0.0'] });
    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
      if (connection === 'open') { isConnected = true; console.log('✅ WhatsApp web conectado'); }
      if (connection === 'close') {
        isConnected = false;
        const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) { connectionAttempted = false; setTimeout(initWhatsApp, 5000); }
      }
    });
    sock.ev.on('creds.update', saveCreds);
  } catch (err) {
    console.error('WhatsApp init error (non-fatal):', err.message);
    connectionAttempted = false;
  }
}

// Tool implementations
export async function wa_get_status() {
  return { connected: isConnected, session: SESSION_PATH };
}

export async function wa_send_message({ phone, message }) {
  if (!isConnected || !sock) throw new Error('WhatsApp no está conectado');
  const jid = formatJid(phone);
  await sock.sendMessage(jid, { text: message });
  return { sent: true, to: phone, message };
}

export async function wa_get_messages({ phone, limit = 10 }) {
  if (!isConnected || !sock) throw new Error('WhatsApp no está conectado');
  const jid = formatJid(phone);
  const messages = await sock.loadMessages(jid, limit);
  return {
    total: messages.length,
    messages: messages.map(m => ({
      from: m.key.fromMe ? 'remi' : phone,
      body: m.message?.conversation || m.message?.extendedTextMessage?.text || '[media]',
      timestamp: m.messageTimestamp,
    }))
  };
}

export async function wa_list_chats({ limit = 10 } = {}) {
  if (!isConnected || !sock) throw new Error('WhatsApp no está conectado');
  return { note: 'Chats disponibles tras interacción activa', connected: isConnected };
}
