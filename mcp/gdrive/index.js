// mcp/gdrive/index.js
// Servidor MCP de Google Drive para Remi
// Requiere: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN en config/.env

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { google } from "googleapis";
import { z } from "zod";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const __file = fileURLToPath(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../config/.env") });

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "urn:ietf:wg:oauth:2.0:oob"
);

oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const drive = google.drive({ version: "v3", auth: oauth2Client });

export function createServer() {
const server = new McpServer({ name: "remi-gdrive", version: "1.0.0" });

// ─── LISTAR ARCHIVOS ─────────────────────────────────────────

server.tool(
  "gdrive_list_files",
  "Lista archivos en Google Drive. Puede filtrar por carpeta o tipo de archivo (imágenes, videos, etc.).",
  {
    folderId: z.string().optional().describe("ID de la carpeta. Si se omite, busca en todo el Drive."),
    mimeType: z.enum(["image", "video", "all"]).optional().default("all").describe("Filtrar por tipo: image, video, o all"),
    limit: z.number().optional().default(20).describe("Máximo de resultados (default 20)"),
  },
  async ({ folderId, mimeType, limit }) => {
    const filters = [];
    if (folderId) filters.push(`'${folderId}' in parents`);
    if (mimeType === "image") filters.push("mimeType contains 'image/'");
    if (mimeType === "video") filters.push("mimeType contains 'video/'");
    filters.push("trashed = false");

    const res = await drive.files.list({
      q: filters.join(" and "),
      pageSize: limit,
      fields: "files(id,name,mimeType,size,modifiedTime,webViewLink,shared)",
      orderBy: "modifiedTime desc",
    });

    const files = res.data.files.map(f => ({
      id: f.id,
      name: f.name,
      type: f.mimeType,
      size: f.size ? `${Math.round(f.size / 1024)} KB` : "—",
      modified: f.modifiedTime,
      shared: f.shared,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${f.id}`,
      viewUrl: f.webViewLink,
    }));

    return { content: [{ type: "text", text: JSON.stringify({ total: files.length, files }, null, 2) }] };
  }
);

// ─── BUSCAR ARCHIVOS ─────────────────────────────────────────

server.tool(
  "gdrive_search_files",
  "Busca archivos en Google Drive por nombre o contenido. Útil para encontrar creativos específicos.",
  {
    query: z.string().describe("Término de búsqueda (nombre del archivo)"),
    mimeType: z.enum(["image", "video", "all"]).optional().default("all"),
    limit: z.number().optional().default(10),
  },
  async ({ query, mimeType, limit }) => {
    const filters = [`name contains '${query}'`, "trashed = false"];
    if (mimeType === "image") filters.push("mimeType contains 'image/'");
    if (mimeType === "video") filters.push("mimeType contains 'video/'");

    const res = await drive.files.list({
      q: filters.join(" and "),
      pageSize: limit,
      fields: "files(id,name,mimeType,size,modifiedTime,parents,shared)",
      orderBy: "modifiedTime desc",
    });

    const files = res.data.files.map(f => ({
      id: f.id,
      name: f.name,
      type: f.mimeType,
      size: f.size ? `${Math.round(f.size / 1024)} KB` : "—",
      modified: f.modifiedTime,
      shared: f.shared,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${f.id}`,
    }));

    return { content: [{ type: "text", text: JSON.stringify({ query, total: files.length, files }, null, 2) }] };
  }
);

// ─── INFO DE ARCHIVO ─────────────────────────────────────────

server.tool(
  "gdrive_get_file",
  "Obtiene metadatos de un archivo específico de Google Drive por su ID.",
  {
    fileId: z.string().describe("ID del archivo en Google Drive"),
  },
  async ({ fileId }) => {
    const res = await drive.files.get({
      fileId,
      fields: "id,name,mimeType,size,modifiedTime,parents,shared,webViewLink,webContentLink",
    });

    const f = res.data;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          id: f.id,
          name: f.name,
          type: f.mimeType,
          size: f.size ? `${Math.round(f.size / 1024)} KB` : "—",
          modified: f.modifiedTime,
          shared: f.shared,
          downloadUrl: `https://drive.google.com/uc?export=download&id=${f.id}`,
          viewUrl: f.webViewLink,
        }, null, 2),
      }],
    };
  }
);

// ─── LISTAR CARPETAS ─────────────────────────────────────────

server.tool(
  "gdrive_list_folders",
  "Lista las carpetas en Google Drive para navegar la estructura y encontrar la carpeta de creativos.",
  {
    parentId: z.string().optional().describe("ID de la carpeta padre. Si se omite, muestra carpetas raíz."),
  },
  async ({ parentId }) => {
    const parent = parentId ? `'${parentId}' in parents` : "'root' in parents";
    const res = await drive.files.list({
      q: `${parent} and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      pageSize: 30,
      fields: "files(id,name,modifiedTime)",
      orderBy: "name",
    });

    return { content: [{ type: "text", text: JSON.stringify({ folders: res.data.files }, null, 2) }] };
  }
);

  return server;
}

// ─── INICIAR (solo cuando se ejecuta directamente) ───────────
if (process.argv[1] === __file) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
console.error("✅ Remi-GDrive v1.0 activo — 4 tools disponibles");
