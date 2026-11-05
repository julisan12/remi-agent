// tools/automation.js
// Permite a Remi gestionar el motor de automatización via MCP

import axios from "axios";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../config/.env") });

const WEBHOOK_PORT = process.env.WEBHOOK_PORT || 3001;
const BASE = `http://localhost:${WEBHOOK_PORT}`;

// Listar reglas activas
export async function listRules() {
  const res = await axios.get(`${BASE}/rules`);
  return res.data;
}

// Crear una regla nueva
export async function createRule({ name, conditions, actions }) {
  const res = await axios.post(`${BASE}/rules`, { name, conditions, actions });
  return res.data;
}

// Actualizar una regla existente
export async function updateRule({ ruleId, name, conditions, actions, active }) {
  const res = await axios.put(`${BASE}/rules/${ruleId}`, { name, conditions, actions, active });
  return res.data;
}

// Activar o pausar una regla
export async function toggleRule({ ruleId }) {
  const res = await axios.patch(`${BASE}/rules/${ruleId}/toggle`);
  return res.data;
}

// Eliminar una regla
export async function deleteRule({ ruleId }) {
  const res = await axios.delete(`${BASE}/rules/${ruleId}`);
  return res.data;
}

// Probar una regla con un evento simulado
export async function testRule({ event }) {
  const res = await axios.post(`${BASE}/rules/test`, { event });
  return res.data;
}

// Estado del servidor de webhooks
export async function getWebhookStatus() {
  const res = await axios.get(`${BASE}/health`);
  return res.data;
}
