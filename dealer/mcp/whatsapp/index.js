// mcp/whatsapp/index.js
// Servidor MCP de WhatsApp via Baileys — Fase 1 (pruebas locales)

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env") });

const SESSION_PATH = process.env.WA_SESSION_PATH || "./memory/wa_session";

let sock = null;
let isConnected = false;

// ─── INICIALIZAR CONEXIÓN WHATSAPP ───────────────────────────

async function connectWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ["Dealer", "Chrome", "1.0.0"],
  });

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.error("\n📱 Escanea este QR con tu WhatsApp:\n");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") {
      isConnected = true;
      console.error("✅ WhatsApp conectado");
    }
    if (connection === "close") {
      isConnected = false;
      const shouldReconnect =
        new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) {
        console.error("🔄 Reconectando WhatsApp...");
        connectWhatsApp();
      } else {
        console.error("❌ Sesión cerrada. Elimina la carpeta de sesión y reinicia.");
      }
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

await connectWhatsApp();

// ─── HELPERS ─────────────────────────────────────────────────

function formatJid(phone) {
  // Normaliza número al formato JID de WhatsApp
  const clean = phone.replace(/\D/g, "");
  return `${clean}@s.whatsapp.net`;
}

function waitForConnection(timeout = 30000) {
  return new Promise((resolve, reject) => {
    if (isConnected) return resolve();
    const interval = setInterval(() => {
      if (isConnected) { clearInterval(interval); resolve(); }
    }, 500);
    setTimeout(() => { clearInterval(interval); reject(new Error("Timeout: WhatsApp no conectó")); }, timeout);
  });
}

// ─── SERVIDOR MCP ─────────────────────────────────────────────

const server = new McpServer({
  name: "dealer-whatsapp",
  version: "1.0.0",
});

server.tool(
  "wa_get_status",
  "Verifica el estado de la conexión de WhatsApp.",
  {},
  async () => {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ connected: isConnected, session: SESSION_PATH }),
      }],
    };
  }
);

server.tool(
  "wa_send_message",
  "Envía un mensaje de WhatsApp a un número.",
  {
    phone: z.string().describe("Número con código de país, ej: +521234567890"),
    message: z.string().describe("Texto del mensaje"),
  },
  async ({ phone, message }) => {
    await waitForConnection();
    const jid = formatJid(phone);
    await sock.sendMessage(jid, { text: message });
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ sent: true, to: phone, message }),
      }],
    };
  }
);

server.tool(
  "wa_get_messages",
  "Lee los mensajes recientes de un chat.",
  {
    phone: z.string().describe("Número con código de país"),
    limit: z.number().optional().default(10).describe("Número de mensajes a obtener"),
  },
  async ({ phone, limit }) => {
    await waitForConnection();
    const jid = formatJid(phone);
    const messages = await sock.loadMessages(jid, limit);
    const result = messages.map((m) => ({
      from: m.key.fromMe ? "dealer" : phone,
      body: m.message?.conversation || m.message?.extendedTextMessage?.text || "[media]",
      timestamp: m.messageTimestamp,
    }));
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ total: result.length, messages: result }),
      }],
    };
  }
);

server.tool(
  "wa_list_chats",
  "Lista los chats activos en WhatsApp.",
  {
    limit: z.number().optional().default(10).describe("Número de chats a listar"),
  },
  async ({ limit }) => {
    await waitForConnection();
    const chats = await sock.groupFetchAllParticipating();
    // Para chats individuales usamos el store si está disponible
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ note: "Chats disponibles tras interacción activa", connected: isConnected }),
      }],
    };
  }
);

// ─── INICIAR SERVIDOR ────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("✅ Dealer-WhatsApp MCP activo — esperando conexión QR");
