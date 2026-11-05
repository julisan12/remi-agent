// src/routes/web.js — API para la interfaz web de Remi
// Montado en /api — expone: /api/web/*, /api/config/*, /api/logs, /api/users/*, /api/admin/*

import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { genToken, setSession, deleteSession, requireToken } from '../middleware/auth.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = path.join(__dirname, '../../memory');
const VAULT_DIR  = path.join(__dirname, '../../vault');
const LOGS_FILE = path.join(MEMORY_DIR, 'activity.jsonl');

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function configPath(name) {
  return path.join(MEMORY_DIR, `${name}.json`);
}

function readConfig(name) {
  const file = configPath(name);
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function writeConfig(name, data) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.writeFileSync(configPath(name), JSON.stringify(data, null, 2), 'utf8');
}

function appendLog(entry) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n';
  fs.appendFileSync(LOGS_FILE, line, 'utf8');
}

function getLogs(limit = 100) {
  if (!fs.existsSync(LOGS_FILE)) return [];
  const lines = fs.readFileSync(LOGS_FILE, 'utf8')
    .split('\n').filter(Boolean).slice(-limit);
  return lines.map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean).reverse();
}

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(pwd || '').digest('hex');
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────

// POST /api/web/login
router.post('/web/login', (req, res) => {
  const { role, password, userId } = req.body;
  const cfg = readConfig('users');

  if (role === 'admin') {
    const admins = (cfg.users || []).filter(u => u.role === 'admin');
    if (!admins.length) return res.json({ ok: false, error: 'No hay cuentas admin configuradas' });
    // Buscar por userId si se envía, si no tomar el primero
    const admin = userId
      ? admins.find(u => u.id === userId)
      : admins[0];
    if (!admin) return res.json({ ok: false, error: 'Cuenta admin no encontrada' });
    if (admin.passwordHash !== hashPassword(password)) {
      return res.json({ ok: false, error: 'Contraseña incorrecta' });
    }
    const user = { id: admin.id, name: admin.name, role: 'admin', vaultFolder: admin.vaultFolder || `usuarios/${admin.id}` };
    const token = genToken(user);
    appendLog({ level: 'info', agent: 'system', msg: `Login admin: ${admin.name}` });
    return res.json({ ok: true, token, user });
  }

  if (role === 'user') {
    const user = (cfg.users || []).find(u => u.id === userId && u.role === 'user');
    if (!user) return res.json({ ok: false, error: 'Usuario no encontrado' });
    if (user.pin && user.pin !== String(password || '')) {
      return res.json({ ok: false, error: 'PIN incorrecto' });
    }
    const userData = {
      id: user.id,
      name: user.name,
      role: 'user',
      assignedAgent: user.assignedAgent,
      allowedTools: user.allowedTools || []
    };
    const token = genToken(userData);
    appendLog({ level: 'info', agent: 'system', msg: `Login web usuario: ${user.name}` });
    return res.json({ ok: true, token, user: userData });
  }

  res.json({ ok: false, error: 'Rol inválido' });
});

// POST /api/web/logout
router.post('/web/logout', requireToken, (req, res) => {
  const token = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  deleteSession(token);
  res.json({ ok: true });
});

// GET /api/web/users — público, para el dropdown del login
router.get('/web/users', (req, res) => {
  const cfg = readConfig('users');
  const users = (cfg.users || [])
    .filter(u => u.role === 'user')
    .map(u => ({ id: u.id, name: u.name }));
  res.json(users);
});

// GET /api/web/admins — público, lista de cuentas admin (solo id y name)
router.get('/web/admins', (req, res) => {
  const cfg = readConfig('users');
  const admins = (cfg.users || [])
    .filter(u => u.role === 'admin')
    .map(u => ({ id: u.id, name: u.name }));
  res.json(admins);
});

// ─── CONFIG ───────────────────────────────────────────────────────────────────

// GET /api/config/:name
router.get('/config/:name', requireToken, (req, res) => {
  const { name } = req.params;
  if (name === 'session') {
    return res.json({ currentUser: req.user });
  }
  res.json(readConfig(name));
});

// POST /api/config/:name
router.post('/config/:name', requireToken, (req, res) => {
  const { name } = req.params;
  const ADMIN_ONLY = ['users', 'server'];
  if (ADMIN_ONLY.includes(name) && req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Solo el admin puede modificar esta configuración' });
  }
  writeConfig(name, req.body);
  res.json({ ok: true });
});

// ─── LOGS ─────────────────────────────────────────────────────────────────────

// GET /api/logs
router.get('/logs', requireToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(getLogs(limit));
});

// POST /api/logs
router.post('/logs', requireToken, (req, res) => {
  appendLog(req.body);
  res.json({ ok: true });
});

// ─── USUARIOS ─────────────────────────────────────────────────────────────────

// POST /api/users/save (solo admin)
router.post('/users/save', requireToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Solo el admin puede guardar usuarios' });
  }
  const cfg = readConfig('users');
  const { users, pendingRequests } = req.body;
  if (users !== undefined) cfg.users = users;
  if (pendingRequests !== undefined) cfg.pendingRequests = pendingRequests;
  writeConfig('users', cfg);
  res.json({ ok: true });
});

// POST /api/users/request-tool
router.post('/users/request-tool', requireToken, (req, res) => {
  const { userId, userName, toolId, toolName, reason } = req.body;
  const cfg = readConfig('users');
  if (!cfg.pendingRequests) cfg.pendingRequests = [];
  cfg.pendingRequests.push({
    id: Date.now(), userId, userName, toolId, toolName, reason,
    ts: new Date().toISOString()
  });
  writeConfig('users', cfg);
  appendLog({ level: 'info', agent: 'system', msg: `Solicitud de tool: ${userName} → ${toolName}` });
  res.json({ ok: true });
});

// ─── ADMIN ────────────────────────────────────────────────────────────────────

// POST /api/admin/change-password
router.post('/admin/change-password', requireToken, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Acceso denegado' });
  }
  const { oldPassword, newPassword } = req.body;
  const cfg = readConfig('users');
  const admin = (cfg.users || []).find(u => u.role === 'admin');
  if (!admin) return res.json({ ok: false, error: 'Admin no encontrado' });
  if (admin.passwordHash !== hashPassword(oldPassword)) {
    return res.json({ ok: false, error: 'Contraseña actual incorrecta' });
  }
  admin.passwordHash = hashPassword(newPassword);
  writeConfig('users', cfg);
  res.json({ ok: true });
});

// ─── VAULT (Obsidian markdown) ────────────────────────────────────────────────

// GET /api/vault — lista archivos .md del vault
router.get('/vault', requireToken, (req, res) => {
  try {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    const files = _listMdFiles(VAULT_DIR, '');
    res.json({ ok: true, files });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// GET /api/vault/* — leer archivo
router.get('/vault/*', requireToken, (req, res) => {
  const rel  = req.params[0];
  const file = path.join(VAULT_DIR, rel);
  if (!file.startsWith(VAULT_DIR)) return res.status(400).json({ ok: false, error: 'Ruta inválida' });
  try {
    const content = fs.readFileSync(file, 'utf8');
    res.json({ ok: true, content });
  } catch {
    res.json({ ok: false, error: 'Archivo no encontrado' });
  }
});

// POST /api/vault/* — escribir archivo
router.post('/vault/*', requireToken, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ ok: false, error: 'Solo admin' });
  const rel  = req.params[0];
  const file = path.join(VAULT_DIR, rel);
  if (!file.startsWith(VAULT_DIR)) return res.status(400).json({ ok: false, error: 'Ruta inválida' });
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, req.body.content || '', 'utf8');
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

function _listMdFiles(dir, prefix) {
  const result = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) result.push(..._listMdFiles(path.join(dir, entry.name), rel));
      else if (entry.name.endsWith('.md')) result.push(rel);
    }
  } catch {}
  return result;
}

// ─── TASKS ────────────────────────────────────────────────────────────────────

// GET /api/tasks/:userId
router.get('/tasks/:userId', requireToken, (req, res) => {
  const { userId } = req.params;
  if (req.user.role !== 'admin' && req.user.id !== userId) {
    return res.status(403).json({ ok: false, error: 'Acceso denegado' });
  }
  const file = path.join(MEMORY_DIR, `tasks_${userId}.json`);
  if (!fs.existsSync(file)) return res.json({ ok: true, tasks: [] });
  try { res.json({ ok: true, tasks: JSON.parse(fs.readFileSync(file, 'utf8')) }); }
  catch { res.json({ ok: true, tasks: [] }); }
});

// POST /api/tasks/:userId
router.post('/tasks/:userId', requireToken, (req, res) => {
  const { userId } = req.params;
  if (req.user.role !== 'admin' && req.user.id !== userId) {
    return res.status(403).json({ ok: false, error: 'Acceso denegado' });
  }
  const file = path.join(MEMORY_DIR, `tasks_${userId}.json`);
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(req.body.tasks || [], null, 2), 'utf8');
  res.json({ ok: true });
});

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

// GET /api/notifications/:userId
router.get('/notifications/:userId', requireToken, (req, res) => {
  const { userId } = req.params;
  if (req.user.role !== 'admin' && req.user.id !== userId) {
    return res.status(403).json({ ok: false, error: 'Acceso denegado' });
  }
  const file = path.join(MEMORY_DIR, `notifications_${userId}.json`);
  if (!fs.existsSync(file)) return res.json({ ok: true, notifications: [] });
  try { res.json({ ok: true, notifications: JSON.parse(fs.readFileSync(file, 'utf8')) }); }
  catch { res.json({ ok: true, notifications: [] }); }
});

// POST /api/notifications/:userId — agregar notificación
router.post('/notifications/:userId', requireToken, (req, res) => {
  const { userId } = req.params;
  const file = path.join(MEMORY_DIR, `notifications_${userId}.json`);
  let notifs = [];
  if (fs.existsSync(file)) { try { notifs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} }
  const notif = { id: Date.now(), ...req.body, ts: new Date().toISOString(), read: false };
  notifs.unshift(notif);
  notifs = notifs.slice(0, 50);
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(notifs, null, 2), 'utf8');
  res.json({ ok: true, notification: notif });
});

// PUT /api/notifications/:userId/read — marcar todas como leídas
router.put('/notifications/:userId/read', requireToken, (req, res) => {
  const { userId } = req.params;
  if (req.user.role !== 'admin' && req.user.id !== userId) {
    return res.status(403).json({ ok: false, error: 'Acceso denegado' });
  }
  const file = path.join(MEMORY_DIR, `notifications_${userId}.json`);
  let notifs = [];
  if (fs.existsSync(file)) { try { notifs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} }
  notifs = notifs.map(n => ({ ...n, read: true }));
  fs.writeFileSync(file, JSON.stringify(notifs, null, 2), 'utf8');
  res.json({ ok: true });
});

export default router;
