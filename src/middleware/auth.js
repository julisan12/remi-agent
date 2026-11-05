// src/middleware/auth.js — Autenticación JWT sin estado
// JWT firmado con HMAC-SHA256 — sobrevive redeploys de Railway sin almacenamiento

import crypto from 'crypto';

const SECRET = process.env.JWT_SECRET || process.env.DESKTOP_API_TOKEN || 'remi-dev-secret-change-me';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

// ── JWT mínimo (sin dependencias externas) ────────────────────────────────────

function b64(str) {
  return Buffer.from(str).toString('base64url');
}

function signJWT(payload) {
  const header  = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body    = b64(JSON.stringify(payload));
  const sig     = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyJWT(token) {
  try {
    const parts = (token || '').split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

/** Genera un JWT firmado con los datos del usuario. Expira en 30 días. */
export function genToken(user = {}) {
  return signJWT({ ...user, iat: Date.now(), exp: Date.now() + TTL_MS });
}

/** Verifica un JWT y devuelve el payload, o null si es inválido/expirado. */
export function getSession(token) {
  return verifyJWT(token);
}

/** No-op — JWT es stateless, no hay nada que guardar. */
export function setSession(_token, _user) {}

/** No-op — el logout se hace borrando el token en el cliente. */
export function deleteSession(_token) {}

/**
 * Middleware Express. Acepta:
 * 1. DESKTOP_API_TOKEN (compatibilidad app desktop)
 * 2. JWT firmado generado en /api/web/login
 */
export function requireToken(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Token requerido' });
  }

  // Opción 1: DESKTOP_API_TOKEN (compatibilidad)
  const desktopToken = process.env.DESKTOP_API_TOKEN;
  if (desktopToken && token === desktopToken) {
    req.user = { id: 'desktop', name: 'Desktop App', role: 'admin' };
    return next();
  }

  // Opción 2: JWT de sesión web
  const payload = verifyJWT(token);
  if (payload) {
    req.user = payload;
    return next();
  }

  return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
}
