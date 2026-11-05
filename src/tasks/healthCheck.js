// src/tasks/healthCheck.js
// Verifica que el servidor responde y alerta al canal #alertas-remi si hay problemas
// Corre cada 5 minutos desde el task-manager

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE   = path.join(__dirname, '../../memory/health-check.log');
const STATE_FILE = path.join(__dirname, '../../memory/health-check-state.json');

const SLACK_ALERTAS_CHANNEL = 'C0AMZ14JLJJ';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line);
  console.log('[HealthCheck]', msg);
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  return { railwayAlerted: false, localAlerted: false };
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function notifySlack(msg) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) return;
    await fetch('https://slack.com/api/chat.postMessage', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ channel: SLACK_ALERTAS_CHANNEL, text: msg }),
    });
  } catch {}
}

async function checkEndpoint(url, label) {
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, version: data.version };
    }
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function runHealthCheck() {
  const state = loadState();
  const RAILWAY_URL = process.env.REMI_RAILWAY_URL;
  const isRailway   = process.env.MONITOR_MODE === 'railway';

  // Railway verifica al servidor local (heartbeat inverso)
  // Local verifica a Railway
  if (isRailway) {
    // En Railway el health check no tiene sentido — si el proceso corre, el servidor responde
    // Solo verificamos que Sendflow esté monitoreable (los enlaces)
    log('Railway activo — health check omitido en Railway (self-check no aplica)');
    return;
  }

  // En local: verificar Railway
  if (!RAILWAY_URL) { log('REMI_RAILWAY_URL no configurado — skip Railway check'); return; }

  const railway = await checkEndpoint(RAILWAY_URL, 'Railway');
  if (railway.ok) {
    log(`Railway OK (v${railway.version})`);
    if (state.railwayAlerted) {
      await notifySlack('✅ *Remi Railway recuperado* — El servidor volvió a responder correctamente.');
      state.railwayAlerted = false;
      saveState(state);
    }
  } else {
    log(`Railway FALLO: ${railway.error}`);
    if (!state.railwayAlerted) {
      await notifySlack(`🚨 *ALERTA — Remi Railway caído*\n\nNo responde en \`${RAILWAY_URL}\`: \`${railway.error}\`\n\nRevisa el dashboard de Railway inmediatamente.\n\n_Remi Health Monitor_`);
      state.railwayAlerted = true;
      saveState(state);
    }
  }
}
