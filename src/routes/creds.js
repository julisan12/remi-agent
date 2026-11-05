// src/routes/creds.js — CRUD de credenciales por usuario
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireToken } from '../middleware/auth.js';

const __dirname_creds = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = path.join(__dirname_creds, '../../memory');
const VAULT_DIR  = path.join(__dirname_creds, '../../vault');

const VALID_SERVICES = ['anthropic', 'google', 'notion', 'slack', 'whatsapp'];

const router = express.Router();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

export function readCreds(userId) {
  const file = path.join(MEMORY_DIR, `creds_${userId}.json`);
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

export function writeCreds(userId, data) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  const file = path.join(MEMORY_DIR, `creds_${userId}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function maskCreds(creds) {
  const masked = {};
  for (const [svc, val] of Object.entries(creds)) {
    if (!val) continue;
    masked[svc] = { ...val };
    masked[svc].connected = true;
    // Mask sensitive fields
    if (masked[svc].api_key)       masked[svc].api_key       = '••••' + val.api_key.slice(-4);
    if (masked[svc].access_token)  masked[svc].access_token  = '[stored]';
    if (masked[svc].refresh_token) masked[svc].refresh_token = '[stored]';
    if (masked[svc].bot_token)     masked[svc].bot_token     = '[stored]';
    if (masked[svc].user_token)    masked[svc].user_token    = '[stored]';
  }
  // Fill in missing services as not connected
  for (const svc of VALID_SERVICES) {
    if (!masked[svc]) masked[svc] = { connected: false };
  }
  return masked;
}

function _syncVaultProfile(userId, creds) {
  try {
    const profilePath = path.join(VAULT_DIR, 'usuarios', userId, 'perfil.md');
    if (!fs.existsSync(profilePath)) return;

    let content = fs.readFileSync(profilePath, 'utf8');

    const connected = Object.entries(creds)
      .filter(([, v]) => v && Object.keys(v).length > 0)
      .map(([k]) => {
        const c = creds[k];
        if (k === 'google')    return `- Google (${c.email || 'conectado'})`;
        if (k === 'notion')    return `- Notion (${c.workspace_name || 'conectado'})`;
        if (k === 'slack')     return `- Slack (${c.team_name || 'conectado'})`;
        if (k === 'anthropic') return `- Claude/Anthropic (API key configurada)`;
        if (k === 'whatsapp')  return `- WhatsApp (${c.phone || 'configurado'})`;
        return `- ${k}`;
      });

    const section = `## Integraciones conectadas\n\n${connected.length > 0 ? connected.join('\n') : '_Ninguna_'}\n`;

    if (content.includes('## Integraciones conectadas')) {
      content = content.replace(/## Integraciones conectadas[\s\S]*?(?=\n## |\n---|\s*$)/, section);
    } else {
      content = content.trimEnd() + '\n\n' + section;
    }

    fs.writeFileSync(profilePath, content, 'utf8');
  } catch (err) {
    console.warn(`[creds] syncVaultProfile failed for ${userId}:`, err.message);
  }
}

// ─── GET /api/creds/status/oauth ─── (público, sin auth) ─────────────────────
router.get('/status/oauth', (req, res) => {
  res.json({
    google: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    notion: !!(process.env.NOTION_CLIENT_ID && process.env.NOTION_CLIENT_SECRET),
    slack:  !!(process.env.SLACK_CLIENT_ID  && process.env.SLACK_CLIENT_SECRET)
  });
});

// ─── GET /api/creds/:userId/status ─── (estado rico para panel UI) ──────────
router.get('/:userId/status', requireToken, (req, res) => {
  const { userId } = req.params;
  if (req.user.role !== 'admin' && req.user.id !== userId) {
    return res.status(403).json({ ok: false, error: 'Acceso denegado' });
  }
  const creds = readCreds(userId);
  const now = Date.now();

  const status = {};
  for (const svc of VALID_SERVICES) {
    const c = creds[svc];
    if (!c || Object.keys(c).length === 0) {
      status[svc] = { connected: false };
      continue;
    }
    const entry = { connected: true, updatedAt: c.updatedAt || null };

    if (svc === 'anthropic') {
      entry.display = c.api_key ? '••••' + c.api_key.slice(-4) : null;
    }
    if (svc === 'google') {
      entry.display = c.email || null;
      entry.name    = c.name || null;
      if (c.expires_at) {
        entry.expiresAt = new Date(c.expires_at).toISOString();
        entry.expired   = now > c.expires_at;
        entry.expiresIn = c.expires_at > now
          ? Math.round((c.expires_at - now) / 60000) + ' min'
          : 'expirado';
      }
    }
    if (svc === 'notion') {
      entry.display = c.workspace_name || null;
      entry.owner   = c.owner_email || null;
    }
    if (svc === 'slack') {
      entry.display = c.team_name || null;
    }
    if (svc === 'whatsapp') {
      entry.display = c.phone || null;
    }
    status[svc] = entry;
  }

  res.json({ ok: true, status });
});

// ─── GET /api/creds/:userId ────────────────────────────────────────────────────
router.get('/:userId', requireToken, (req, res) => {
  const { userId } = req.params;
  if (req.user.role !== 'admin' && req.user.id !== userId) {
    return res.status(403).json({ ok: false, error: 'Acceso denegado' });
  }
  const creds = readCreds(userId);
  res.json({ ok: true, creds: maskCreds(creds) });
});

// ─── POST /api/creds/:userId/:service ─────────────────────────────────────────
router.post('/:userId/:service', requireToken, (req, res) => {
  const { userId, service } = req.params;
  if (req.user.role !== 'admin' && req.user.id !== userId) {
    return res.status(403).json({ ok: false, error: 'Acceso denegado' });
  }
  if (!VALID_SERVICES.includes(service)) {
    return res.status(400).json({ ok: false, error: `Servicio inválido: ${service}` });
  }

  const creds = readCreds(userId);
  creds[service] = {
    ...(creds[service] || {}),
    ...req.body,
    updatedAt: new Date().toISOString()
  };
  writeCreds(userId, creds);
  _syncVaultProfile(userId, creds);

  res.json({ ok: true, service });
});

// ─── DELETE /api/creds/:userId/:service ───────────────────────────────────────
router.delete('/:userId/:service', requireToken, (req, res) => {
  const { userId, service } = req.params;
  if (req.user.role !== 'admin' && req.user.id !== userId) {
    return res.status(403).json({ ok: false, error: 'Acceso denegado' });
  }
  if (!VALID_SERVICES.includes(service)) {
    return res.status(400).json({ ok: false, error: `Servicio inválido: ${service}` });
  }

  const creds = readCreds(userId);
  delete creds[service];
  writeCreds(userId, creds);
  _syncVaultProfile(userId, creds);

  res.json({ ok: true, service });
});

export default router;
