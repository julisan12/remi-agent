// src/lib/task-manager.js
// Gestor de tareas programadas — persiste en memory/scheduled-tasks.json
// Remi puede crear, listar, pausar, eliminar y ejecutar tareas desde el chat

import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TASKS_FILE = path.join(__dirname, '../../memory/scheduled-tasks.json');

// Map de taskId → instancia cron activa
const activeCrons = new Map();

// ─── Persistencia ─────────────────────────────────────────────────────────────
function loadTasks() {
  try {
    if (fs.existsSync(TASKS_FILE)) return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
  } catch {}
  return { tasks: [] };
}

function saveTasks(data) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Ejecutar tarea por tipo ──────────────────────────────────────────────────
async function runTask(task) {
  console.log(`⏰ [TASK] ${task.name} — iniciando`);

  // Actualizar lastRun
  const data = loadTasks();
  const idx = data.tasks.findIndex(t => t.id === task.id);
  if (idx >= 0) {
    data.tasks[idx].lastRun = new Date().toISOString();
    saveTasks(data);
  }

  try {
    if (task.type === 'job_search') {
      const { runJobSearch } = await import('../tasks/jobSearch.js');
      await runJobSearch();
    } else if (task.type === 'sendflow_monitor') {
      const { runSendflowMonitor } = await import('../tasks/sendflowMonitor.js');
      await runSendflowMonitor();
    } else if (task.type === 'health_check') {
      const { runHealthCheck } = await import('../tasks/healthCheck.js');
      await runHealthCheck();
    } else if (task.type === 'precio_bcv') {
      const { runActualizarPrecio } = await import('../tasks/actualizarPrecio.js');
      await runActualizarPrecio({ dryRun: task.config?.dryRun || false });
    } else if (task.type === 'seguimiento_ventas') {
      const { runSeguimientoVentas } = await import('../tasks/seguimientoVentas.js');
      await runSeguimientoVentas({ dryRun: task.config?.dryRun || false });
    } else if (task.type === 'remi_prompt') {
      // Ejecutar un prompt de Remi vía el API interno
      await _runRemiPrompt(task.config?.agentId || 'remi-main', task.config?.prompt || '');
    } else {
      console.log(`[TASK] Tipo desconocido: ${task.type}`);
    }
    console.log(`✅ [TASK] ${task.name} — completada`);
  } catch (err) {
    console.error(`❌ [TASK] ${task.name} — error:`, err.message);
  }
}

// Ejecutar un prompt de Remi como tarea (para tareas tipo remi_prompt)
async function _runRemiPrompt(agentId, prompt) {
  if (!prompt) return;
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const result = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });
  console.log(`[TASK remi_prompt] ${agentId}:`, result.content[0]?.text?.slice(0, 200));
}

// ─── Inicializar (llamar al arrancar el servidor) ──────────────────────────────
export function initTaskManager() {
  // Detener crons previos (hot reload)
  for (const [id, job] of activeCrons) {
    job.stop();
    activeCrons.delete(id);
  }

  const data = loadTasks();
  let active = 0;

  for (const task of data.tasks) {
    if (!task.enabled) continue;
    if (!cron.validate(task.schedule)) {
      console.warn(`[TASK] Schedule inválido para "${task.name}": ${task.schedule}`);
      continue;
    }
    const job = cron.schedule(task.schedule, () => runTask(task), {
      timezone: task.timezone || 'America/Caracas',
    });
    activeCrons.set(task.id, job);
    active++;
  }

  console.log(`✅ Task Manager: ${active}/${data.tasks.length} tareas activas`);
}

// ─── CRUD de tareas (expuesto como tools a Remi) ──────────────────────────────

export function listScheduledTasks() {
  const data = loadTasks();
  return data.tasks.map(t => ({
    id:          t.id,
    name:        t.name,
    schedule:    t.schedule,
    timezone:    t.timezone || 'America/Caracas',
    description: t.description,
    type:        t.type,
    enabled:     t.enabled,
    lastRun:     t.lastRun || 'nunca',
    status:      t.enabled ? '🟢 activa' : '⏸ pausada',
  }));
}

export function createScheduledTask({ name, schedule, description = '', type = 'remi_prompt', timezone = 'America/Caracas', config = {} }) {
  if (!name || !schedule) throw new Error('name y schedule son obligatorios');
  if (!cron.validate(schedule)) throw new Error(`Schedule inválido: "${schedule}". Usa formato cron (ej: "0 9 * * 1-5")`);

  const data = loadTasks();
  const newTask = {
    id:          `task_${Date.now()}`,
    name,
    schedule,
    timezone,
    description,
    type,
    config,
    enabled:     true,
    createdAt:   new Date().toISOString(),
    lastRun:     null,
  };
  data.tasks.push(newTask);
  saveTasks(data);

  // Activar cron inmediatamente
  const job = cron.schedule(schedule, () => runTask(newTask), { timezone });
  activeCrons.set(newTask.id, job);

  return `✅ Tarea "${name}" creada (ID: ${newTask.id}) — próxima ejecución según: ${schedule} (${timezone})`;
}

export function toggleScheduledTask({ taskId }) {
  const data = loadTasks();
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) throw new Error(`Tarea "${taskId}" no encontrada`);

  task.enabled = !task.enabled;
  saveTasks(data);

  if (task.enabled && cron.validate(task.schedule)) {
    const job = cron.schedule(task.schedule, () => runTask(task), { timezone: task.timezone || 'America/Caracas' });
    activeCrons.set(taskId, job);
  } else {
    activeCrons.get(taskId)?.stop();
    activeCrons.delete(taskId);
  }

  return `${task.enabled ? '▶️ Activada' : '⏸ Pausada'}: "${task.name}"`;
}

export function deleteScheduledTask({ taskId }) {
  const data = loadTasks();
  const idx = data.tasks.findIndex(t => t.id === taskId);
  if (idx < 0) throw new Error(`Tarea "${taskId}" no encontrada`);

  activeCrons.get(taskId)?.stop();
  activeCrons.delete(taskId);
  const name = data.tasks[idx].name;
  data.tasks.splice(idx, 1);
  saveTasks(data);

  return `🗑️ Tarea "${name}" eliminada`;
}

export async function runScheduledTaskNow({ taskId }) {
  const data = loadTasks();
  const task = data.tasks.find(t => t.id === taskId);
  if (!task) throw new Error(`Tarea "${taskId}" no encontrada`);
  await runTask(task);
  return `✅ Tarea "${task.name}" ejecutada manualmente`;
}
