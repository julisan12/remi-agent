// src/tasks/sendflowMonitor.js
// Monitor automático del enlace de invitación WhatsApp de Sendflow
// Primario: corre local via scheduled-tasks MCP cada 10 min
// Fallback: Railway toma control si el local lleva >15 min sin heartbeat

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE   = path.join(__dirname, '../../memory/sendflow-monitor.log');
const STATE_FILE = path.join(__dirname, '../../memory/sendflow-monitor-state.json');

const CAMPAIGNS = JSON.parse(process.env.SENDFLOW_CAMPAIGNS || '[]');

const CONFIG = {
  email:    process.env.SENDFLOW_EMAIL || '',
  password: process.env.SENDFLOW_PASSWORD || '',
};

const VALID_TEXTS   = ['Invitación a grupo', 'Invitación a un chat', 'Unirse al grupo', 'Join group'];
const INVALID_TEXTS = ['enlace no es válido', 'grupo está lleno', 'No existe', 'revocado'];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, line);
  console.log('[SendflowMonitor]', msg);
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Verificación rápida sin browser (primera línea de detección) ─────────────
async function checkLinkFetch(link) {
  try {
    const res = await fetch(link, {
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    const finalUrl = res.url;
    if (finalUrl.includes('chat.whatsapp.com') || finalUrl.includes('wa.me')) {
      const html = await res.text();
      if (INVALID_TEXTS.some(t => html.includes(t))) return 'down';
      return 'ok';
    }
    return 'down';
  } catch { return 'down'; }
}

// ─── Confirmación con browser — solo cuando fetch dice 'down' ─────────────────
// sndflw.com puede redirigir via JS (no HTTP 301), fetch no lo sigue
async function checkLinkBrowser(link, page) {
  try {
    await page.goto(link, { waitUntil: 'networkidle', timeout: 15000 });
    const finalUrl = page.url();
    if (finalUrl.includes('chat.whatsapp.com') || finalUrl.includes('wa.me')) {
      const html = await page.content();
      if (INVALID_TEXTS.some(t => html.includes(t))) return 'down';
      return 'ok';
    }
    log(`checkLink browser: URL inesperada: ${finalUrl}`);
    return 'down';
  } catch (err) {
    log(`checkLink browser error: ${err.message}`);
    return 'down';
  }
}

// ─── Heartbeat — informa a Railway que el local está activo ──────────────────
async function sendHeartbeat() {
  if (process.env.MONITOR_MODE === 'railway') return;
  try {
    const url   = process.env.REMI_RAILWAY_URL;
    const token = process.env.REMI_SECRET_TOKEN;
    if (!url || !token) return;
    const res = await fetch(`${url}/heartbeat/sendflow`, {
      method:  'POST',
      headers: { 'x-remi-token': token },
      signal:  AbortSignal.timeout(5000),
    });
    log(res.ok ? 'Heartbeat enviado a Railway' : `Heartbeat falló: ${res.status}`);
  } catch (err) {
    log(`Heartbeat no enviado: ${err.message} — Railway tomará control si es necesario`);
  }
}

// ─── Restaurar sesión de Sendflow desde archivo guardado ─────────────────────
async function restoreSession(page) {
  try {
    const sessionFile = path.join(__dirname, '../../memory/sendflow-session.json');
    if (!fs.existsSync(sessionFile)) return false;
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    if (!session.firebase?.refreshToken) return false;

    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${session.firebase.apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ grant_type: 'refresh_token', refresh_token: session.firebase.refreshToken }),
    });
    if (!res.ok) return false;
    const { access_token, refresh_token } = await res.json();

    session.firebase.refreshToken = refresh_token;
    fs.writeFileSync(sessionFile, JSON.stringify(session, null, 2));

    await page.goto('https://sendflow.pro', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(({ uid, apiKey, accessToken, refreshToken, loginId }) => {
      const authData = {
        uid, email: process.env.SENDFLOW_EMAIL || '', emailVerified: true,
        displayName: 'Usuario', isAnonymous: false,
        providerData: [{ providerId: 'password', uid: process.env.SENDFLOW_EMAIL || '', displayName: 'Usuario', email: process.env.SENDFLOW_EMAIL || '', phoneNumber: null, photoURL: null }],
        stsTokenManager: { refreshToken, accessToken, expirationTime: Date.now() + 3600000 },
        createdAt: String(Date.now()), lastLoginAt: String(Date.now()),
        apiKey, appName: '[DEFAULT]',
      };
      localStorage.setItem(`firebase:authUser:${apiKey}:[DEFAULT]`, JSON.stringify(authData));
      if (loginId) localStorage.setItem('login_id', loginId);
    }, { uid: session.firebase.uid, apiKey: session.firebase.apiKey, accessToken: access_token, refreshToken: refresh_token, loginId: session.loginId });

    await page.reload({ waitUntil: 'networkidle', timeout: 15000 });
    const url = page.url();
    return url.includes('/whats/') || url.includes('/dashboard');
  } catch (err) {
    log(`Restore session falló: ${err.message}`);
    return false;
  }
}

// ─── Corrección automática en Sendflow ───────────────────────────────────────
async function fixSendflow(page, campaign) {
  try {
    const restored = await restoreSession(page);
    if (!restored) {
      log('Sesión guardada inválida — haciendo login normal');
      await page.goto('https://sendflow.pro/login', { waitUntil: 'networkidle', timeout: 20000 });
      await page.locator('input[name="email"]').pressSequentially(CONFIG.email);
      await page.locator('input[name="password"], input[type="password"]').pressSequentially(CONFIG.password);
      await page.locator('button:has-text("Login")').click();
      await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
    }

    await page.click('a:has-text("Campañas"), a:has-text("Campaigns")');
    await page.waitForTimeout(2000);
    await page.click(`text=${campaign.name}`);
    await page.waitForTimeout(2000);

    const toggles = await page.locator('input[type="checkbox"], .toggle, .switch').all();
    let switched = false;
    for (const toggle of toggles) {
      const isChecked = await toggle.isChecked().catch(() => false);
      if (isChecked && !switched) {
        await toggle.click();
        await page.waitForTimeout(1000);
        switched = true;
      } else if (!isChecked && switched) {
        await toggle.click();
        await page.waitForTimeout(1000);
        break;
      }
    }

    const saveBtn = page.locator('button:has-text("Guardar"), button:has-text("Save")');
    if (await saveBtn.count() > 0) await saveBtn.click();
    await page.waitForTimeout(2000);

    await page.click('a:has-text("Grupos"), a:has-text("Groups")').catch(() => {});
    await page.waitForTimeout(2000);
    await page.click('button:has-text("Actualizar enlace"), button:has-text("Update link")').catch(() => {});
    await page.waitForTimeout(3000);

    return true;
  } catch (err) {
    log(`ERROR en fixSendflow: ${err.message}`);
    return false;
  }
}

// ─── Notificación al canal #alertas-remi ─────────────────────────────────────
const SLACK_ALERTAS_CHANNEL = 'C0AMZ14JLJJ';

async function notifySlack(msg) {
  try {
    const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
    if (!SLACK_BOT_TOKEN) { log('SLACK_BOT_TOKEN no configurado'); return; }
    await fetch('https://slack.com/api/chat.postMessage', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ channel: SLACK_ALERTAS_CHANNEL, text: msg }),
    });
    log('Alerta enviada al canal #alertas-remi');
  } catch (err) {
    log(`Error enviando Slack: ${err.message}`);
  }
}

// ─── Verificar campaña y actuar si es necesario ───────────────────────────────
async function monitorCampaign(browser, page, campaign, state, quickStatus) {
  log(`Verificando campaña: ${campaign.name}`);

  // Si fetch ya dijo ok no hace falta confirmar con browser
  let status = quickStatus;
  if (status === 'down') {
    log(`Fetch dice down para ${campaign.name} — reconfirmando con browser`);
    status = await checkLinkBrowser(campaign.link, page);
  }

  if (status === 'ok') {
    if (state[campaign.campaignId]?.failures > 0)
      log(`RECUPERADO - ${campaign.name}: enlace activo`);
    else
      log(`OK - ${campaign.name}: enlace activo`);
    state[campaign.campaignId] = { failures: 0, alerted: false };
    return;
  }

  // Fallo confirmado por browser
  const prev = state[campaign.campaignId] || { failures: 0, alerted: false };
  prev.failures = (prev.failures || 0) + 1;
  state[campaign.campaignId] = prev;
  log(`CAÍDO (confirmado) - ${campaign.name}: falla #${prev.failures}`);

  if (prev.alerted) {
    log(`${campaign.name} sigue caído — Johnson ya fue notificado, sin spam`);
    return;
  }

  // Primer fallo confirmado — intentar autocorrección
  const fixPage = await browser.newPage();
  const fixed = await fixSendflow(fixPage, campaign);
  await fixPage.close();

  if (fixed) {
    const recheckPage = await browser.newPage();
    const statusAfter = await checkLinkBrowser(campaign.link, recheckPage);
    await recheckPage.close();

    if (statusAfter === 'ok') {
      log(`CORREGIDO - ${campaign.name}: número secundario activado, enlace restaurado`);
      state[campaign.campaignId] = { failures: 0, alerted: false };
      return;
    }
  }

  // No se pudo corregir — alertar a Johnson (una sola vez por incidente)
  const msg = fixed
    ? `🚨 *ALERTA SENDFLOW — ${campaign.name}*\n\nHola. El enlace de invitación de *${campaign.name}* continúa caído incluso después de activar el número secundario.\n\nSe requiere intervención manual urgente.\n\n_Remi — Tu Academia_`
    : `🚨 *ALERTA SENDFLOW — ${campaign.name}*\n\nHola. El enlace de invitación de *${campaign.name}* está caído y no se pudo completar la corrección automática.\n\nSe requiere revisión manual.\n\n_Remi — Tu Academia_`;

  await notifySlack(msg);
  prev.alerted = true;
  log(`ALERTA enviada a la operadora — ${campaign.name}`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────
export async function runSendflowMonitor() {
  // Guard: Railway solo corre si el local no está activo
  if (process.env.MONITOR_MODE === 'railway') {
    const { isLocalActive } = await import('../lib/heartbeat.js');
    if (isLocalActive('sendflow')) {
      log('Local activo (heartbeat reciente) — Railway skipping');
      return;
    }
    log('Heartbeat vencido o nunca recibido — Railway toma control');
  }

  const state = loadState();

  // Pre-check rápido con fetch (sin browser) — evita abrir Chromium si todo está ok
  const quickStatuses = await Promise.all(CAMPAIGNS.map(c => checkLinkFetch(c.link)));
  const allOk = quickStatuses.every(s => s === 'ok');

  if (allOk) {
    for (const campaign of CAMPAIGNS) {
      state[campaign.campaignId] = { failures: 0, alerted: false };
    }
    saveState(state);
    log('Verificación rápida OK — todos los enlaces activos, sin acciones');
    await sendHeartbeat();
    return;
  }

  // Al menos uno falló el pre-check — abrir browser para confirmar y corregir
  const isRailway = process.env.MONITOR_MODE === 'railway';
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      ...(isRailway ? ['--single-process'] : []),
    ],
  });
  const page = await browser.newPage();

  try {
    for (let i = 0; i < CAMPAIGNS.length; i++) {
      await monitorCampaign(browser, page, CAMPAIGNS[i], state, quickStatuses[i]);
    }
  } finally {
    await browser.close();
    saveState(state);
    await sendHeartbeat();
  }
}
