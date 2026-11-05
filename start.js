#!/usr/bin/env node
/**
 * start.js — Launcher del plugin Remi
 *
 * Este archivo reemplaza la llamada directa a mcp/ghl/index.js en el .mcp.json.
 * Se asegura de que node_modules y los navegadores de Playwright estén instalados
 * ANTES de arrancar el servidor MCP. Los compañeros no necesitan correr nada manualmente.
 *
 * Uso en .mcp.json:
 *   "command": "node",
 *   "args": ["RUTA_REMI/start.js", "ghl"]        ← para GHL (ventas/soporte)
 *   "args": ["RUTA_REMI/start.js", "meta"]       ← para Meta Ads
 *   "args": ["RUTA_REMI/start.js", "whatsapp"]   ← para WhatsApp
 */

import { existsSync } from "fs";
import { execSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const server = process.argv[2] || "ghl";

// ─── PASO 1: Instalar node_modules si no existen ─────────────
if (!existsSync(join(__dirname, "node_modules"))) {
  process.stderr.write("📦 Primera ejecución — instalando dependencias (esto toma ~1 min)...\n");
  try {
    execSync("npm install --silent", {
      cwd: __dirname,
      stdio: ["ignore", "ignore", "inherit"],
      timeout: 180000, // 3 minutos máximo
    });
    process.stderr.write("✅ Dependencias instaladas.\n");
  } catch (err) {
    process.stderr.write(`⚠️  npm install falló: ${err.message}\n`);
    process.stderr.write("   Instala Node.js 18+ desde https://nodejs.org y vuelve a intentar.\n");
    process.exit(1);
  }
}

// ─── PASO 2: Instalar Playwright en background ────────────────
// Solo si chromium no está disponible. No bloquea el arranque.
try {
  const check = spawnSync("npx", ["playwright", "install", "chromium"], {
    stdio: "ignore",
    shell: process.platform === "win32",
    timeout: 120000,
  });
  if (check.status !== 0) {
    // Intento silencioso — si falla, el Playwright MCP del .mcp.json seguirá funcionando
    process.stderr.write("⚠️  Playwright chromium no pudo instalarse automáticamente.\n");
    process.stderr.write("   Corre manualmente: npx playwright install chromium\n");
  }
} catch {}

// ─── PASO 3: Arrancar el servidor MCP ────────────────────────
const servers = {
  ghl:       "./mcp/ghl/index.js",
  meta:      "./mcp/meta/index.js",
  whatsapp:  "./mcp/whatsapp/index.js",
  gdrive:    "./mcp/gdrive/index.js",
};

const target = servers[server];
if (!target) {
  process.stderr.write(`❌ Servidor desconocido: "${server}". Opciones: ghl, meta, whatsapp, gdrive\n`);
  process.exit(1);
}

// Importación dinámica — en este punto node_modules ya existe
import(target).catch((err) => {
  process.stderr.write(`❌ Error al iniciar servidor ${server}: ${err.message}\n`);
  process.exit(1);
});
