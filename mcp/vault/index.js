// mcp/vault/index.js
// Servidor MCP de Obsidian Vault para Remi — memoria persistente del equipo
// Permite leer, escribir y buscar notas en el vault sincronizado con GitHub

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VAULT_DIR = path.join(__dirname, "../../vault");

// ─── HELPERS ─────────────────────────────────────────────────

function readFile(relativePath) {
  const fullPath = path.join(VAULT_DIR, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf8");
}

async function writeFile(relativePath, content) {
  const fullPath = path.join(VAULT_DIR, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf8");

  // Sincronizar con GitHub
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || "julisan12/remi";
  if (token && repo) {
    const apiUrl = `https://api.github.com/repos/${repo}/contents/vault/${relativePath}`;
    const headers = {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    };
    let sha;
    try {
      const getRes = await fetch(apiUrl, { headers });
      if (getRes.ok) sha = (await getRes.json()).sha;
    } catch {}
    const body = {
      message: `[remi-vault] sync ${path.basename(relativePath)}`,
      content: Buffer.from(content).toString("base64"),
      ...(sha && { sha }),
    };
    await fetch(apiUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    }).catch((err) => console.error("[vault] GitHub sync error:", err.message));
  }
}

function searchFiles(query) {
  const results = [];
  function walk(dir, base = "") {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else if (entry.name.endsWith(".md")) {
        const content = fs.readFileSync(path.join(dir, entry.name), "utf8");
        if (content.toLowerCase().includes(query.toLowerCase())) {
          results.push({ path: rel, preview: content.slice(0, 200) });
        }
      }
    }
  }
  walk(VAULT_DIR);
  return results;
}

function listFolder(relativePath = "") {
  const dir = path.join(VAULT_DIR, relativePath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({
    name: e.name,
    type: e.isDirectory() ? "folder" : "file",
    path: relativePath ? `${relativePath}/${e.name}` : e.name,
  }));
}

// ─── FACTORY ─────────────────────────────────────────────────

export function createServer() {
  const server = new McpServer({ name: "remi-vault", version: "1.0.0" });

  server.tool(
    "vault_read_note",
    "Lee una nota del vault de Obsidian. Úsalo para cargar perfiles del equipo, contexto de proyectos o cualquier nota guardada.",
    { path: z.string().describe("Ruta relativa dentro del vault, ej: equipo/nombre-apellido.md") },
    async ({ path: relativePath }) => {
      const content = readFile(relativePath);
      if (!content) {
        return { content: [{ type: "text", text: `❌ Nota no encontrada: ${relativePath}` }] };
      }
      return { content: [{ type: "text", text: content }] };
    }
  );

  server.tool(
    "vault_write_note",
    "Crea o actualiza una nota en el vault de Obsidian. Se sincroniza automáticamente con GitHub y Obsidian. Úsalo para guardar perfiles del equipo, notas de proyecto, aprendizajes importantes.",
    {
      path: z.string().describe("Ruta relativa dentro del vault, ej: equipo/nombre-apellido.md"),
      content: z.string().describe("Contenido completo de la nota en formato Markdown"),
    },
    async ({ path: relativePath, content }) => {
      await writeFile(relativePath, content);
      return { content: [{ type: "text", text: `✅ Nota guardada: ${relativePath}` }] };
    }
  );

  server.tool(
    "vault_search",
    "Busca notas en el vault que contengan un término. Útil para encontrar información sobre compañeros, proyectos o temas específicos.",
    { query: z.string().describe("Término a buscar en el contenido de las notas") },
    async ({ query }) => {
      const results = searchFiles(query);
      if (!results.length) {
        return { content: [{ type: "text", text: `🔍 Sin resultados para: "${query}"` }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    }
  );

  server.tool(
    "vault_list_folder",
    "Lista el contenido de una carpeta del vault. Sin parámetros lista la raíz.",
    { folder: z.string().optional().describe("Carpeta relativa a listar, ej: equipo") },
    async ({ folder }) => {
      const entries = listFolder(folder || "");
      return { content: [{ type: "text", text: JSON.stringify(entries, null, 2) }] };
    }
  );

  server.tool(
    "vault_update_section",
    "Actualiza una sección específica (## Título) de una nota existente sin reemplazar el resto del contenido.",
    {
      path: z.string().describe("Ruta de la nota, ej: equipo/nombre.md"),
      section: z.string().describe("Título de la sección a actualizar, ej: Proyectos activos"),
      content: z.string().describe("Nuevo contenido para esa sección"),
    },
    async ({ path: relativePath, section, content: newContent }) => {
      let current = readFile(relativePath) || "";
      const sectionRegex = new RegExp(`(## ${section}[\\s\\S]*?)(?=\\n## |$)`, "i");
      const sectionBlock = `## ${section}\n${newContent}\n`;
      if (sectionRegex.test(current)) {
        current = current.replace(sectionRegex, sectionBlock);
      } else {
        current += `\n${sectionBlock}`;
      }
      await writeFile(relativePath, current);
      return { content: [{ type: "text", text: `✅ Sección "${section}" actualizada en ${relativePath}` }] };
    }
  );

  return server;
}

// ─── INICIAR (solo cuando se ejecuta directamente) ───────────
if (process.argv[1] === __filename) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Remi-Vault MCP activo — 5 tools disponibles");
}
