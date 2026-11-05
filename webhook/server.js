// webhook/server.js
// Servidor de webhooks de Remi + Motor de automatización
// Puerto: 3001

import express from "express";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import dotenv from "dotenv";

import { searchContact, createContact } from "../mcp/ghl/tools/contacts.js";
import { sendMessage } from "../mcp/ghl/tools/conversations.js";
import { createOpportunity, listPipelines, moveOpportunity } from "../mcp/ghl/tools/opportunities.js";
import { addTagsToContact, createContactNote } from "../mcp/ghl/tools/tags-notes-tasks.js";
import { addContactToWorkflow } from "../mcp/ghl/tools/workflows.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../config/.env") });

const app = express();
app.use(express.json());

const RULES_PATH = resolve(__dirname, "../memory/rules.json");

// ─── CARGAR REGLAS ────────────────────────────────────────────

function loadRules() {
  try {
    if (!fs.existsSync(RULES_PATH)) return [];
    return JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  } catch {
    return [];
  }
}

function saveRules(rules) {
  fs.writeFileSync(RULES_PATH, JSON.stringify(rules, null, 2));
}

// ─── MOTOR DE REGLAS ─────────────────────────────────────────

async function evaluateRules(event) {
  const rules = loadRules();
  const matched = [];

  for (const rule of rules) {
    if (!rule.active) continue;

    // Evaluar condiciones
    const conditionsMet = rule.conditions.every((cond) => {
      const value = getEventValue(event, cond.field);
      switch (cond.operator) {
        case "contains":
          return typeof value === "string" && value.toLowerCase().includes(cond.value.toLowerCase());
        case "equals":
          return value === cond.value;
        case "not_equals":
          return value !== cond.value;
        case "exists":
          return value !== undefined && value !== null && value !== "";
        default:
          return false;
      }
    });

    if (conditionsMet) {
      console.log(`✅ Regla activada: ${rule.name}`);
      matched.push(rule);
      await executeActions(rule.actions, event);
    }
  }

  return matched;
}

function getEventValue(event, field) {
  // Acceso a campos anidados con dot notation: "contact.phone"
  return field.split(".").reduce((obj, key) => obj?.[key], event);
}

// ─── EJECUTAR ACCIONES ───────────────────────────────────────

async function executeActions(actions, event) {
  for (const action of actions) {
    try {
      console.log(`⚡ Ejecutando acción: ${action.type}`);

      switch (action.type) {

        case "create_opportunity": {
          const contactId = event.contact?.id || event.contactId;
          if (!contactId) break;
          await createOpportunity({
            contactId,
            pipelineId: action.pipelineId,
            stageId: action.stageId,
            name: interpolate(action.name || "Nueva oportunidad", event),
            value: action.value || 0,
          });
          break;
        }

        case "move_opportunity": {
          if (!event.opportunityId) break;
          await moveOpportunity({
            opportunityId: event.opportunityId,
            newStageId: action.stageId,
          });
          break;
        }

        case "send_message": {
          const contactId = event.contact?.id || event.contactId;
          if (!contactId) break;
          await sendMessage({
            contactId,
            message: interpolate(action.message, event),
            type: action.channel || "WhatsApp",
          });
          break;
        }

        case "add_tags": {
          const contactId = event.contact?.id || event.contactId;
          if (!contactId) break;
          await addTagsToContact({
            contactId,
            tags: action.tags,
          });
          break;
        }

        case "create_note": {
          const contactId = event.contact?.id || event.contactId;
          if (!contactId) break;
          await createContactNote({
            contactId,
            body: interpolate(action.note, event),
          });
          break;
        }

        case "add_to_workflow": {
          const contactId = event.contact?.id || event.contactId;
          if (!contactId) break;
          await addContactToWorkflow({
            contactId,
            workflowId: action.workflowId,
          });
          break;
        }

        case "wait": {
          await new Promise((r) => setTimeout(r, (action.seconds || 5) * 1000));
          break;
        }

        case "log": {
          console.log(`📋 LOG: ${interpolate(action.message, event)}`);
          break;
        }

        default:
          console.warn(`⚠️ Acción desconocida: ${action.type}`);
      }

    } catch (err) {
      console.error(`❌ Error en acción ${action.type}:`, err.message);
    }
  }
}

// ─── INTERPOLACIÓN DE VARIABLES ──────────────────────────────
// Permite usar {{contact.name}} en mensajes y nombres

function interpolate(template, event) {
  if (!template) return "";
  return template.replace(/\{\{(.+?)\}\}/g, (_, path) => {
    return getEventValue(event, path.trim()) || "";
  });
}

// ─── ENDPOINTS ───────────────────────────────────────────────

// Webhook principal de GHL
app.post("/webhook/ghl", async (req, res) => {
  const payload = req.body;
  console.log("\n📨 Webhook GHL recibido:", JSON.stringify(payload, null, 2));

  res.status(200).json({ received: true });

  // Normalizar el evento
  const event = {
    type: "ghl_webhook",
    contactId: payload.contact_id || payload.contactId,
    contact: {
      id: payload.contact_id || payload.contactId,
      name: payload.full_name || payload.contact_name || "",
      phone: payload.phone || "",
      email: payload.email || "",
    },
    message: payload.message || payload.body || "",
    channel: payload.type || "whatsapp",
    locationId: payload.location_id || payload.locationId,
    timestamp: new Date().toISOString(),
    raw: payload,
  };

  // Ejecutar motor de reglas
  const matched = await evaluateRules(event);
  console.log(`\n✅ ${matched.length} regla(s) ejecutada(s)`);
});

// Webhook de WhatsApp (Baileys)
app.post("/webhook/whatsapp", async (req, res) => {
  const payload = req.body;
  console.log("\n📱 Webhook WhatsApp recibido:", JSON.stringify(payload, null, 2));

  res.status(200).json({ received: true });

  const event = {
    type: "whatsapp_message",
    contactId: null,
    contact: {
      phone: payload.from || "",
      name: payload.pushName || "",
    },
    message: payload.body || "",
    channel: "whatsapp",
    timestamp: new Date().toISOString(),
    raw: payload,
  };

  await evaluateRules(event);
});

// ─── API DE GESTIÓN DE REGLAS ────────────────────────────────

// Listar reglas
app.get("/rules", (req, res) => {
  res.json(loadRules());
});

// Crear regla
app.post("/rules", (req, res) => {
  const rules = loadRules();
  const newRule = {
    id: `rule_${Date.now()}`,
    name: req.body.name,
    active: true,
    conditions: req.body.conditions || [],
    actions: req.body.actions || [],
    createdAt: new Date().toISOString(),
  };
  rules.push(newRule);
  saveRules(rules);
  console.log(`\n📋 Nueva regla creada: ${newRule.name}`);
  res.json({ created: true, rule: newRule });
});

// Actualizar regla
app.put("/rules/:id", (req, res) => {
  const rules = loadRules();
  const idx = rules.findIndex((r) => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Regla no encontrada" });
  rules[idx] = { ...rules[idx], ...req.body, id: req.params.id };
  saveRules(rules);
  res.json({ updated: true, rule: rules[idx] });
});

// Activar / pausar regla
app.patch("/rules/:id/toggle", (req, res) => {
  const rules = loadRules();
  const rule = rules.find((r) => r.id === req.params.id);
  if (!rule) return res.status(404).json({ error: "Regla no encontrada" });
  rule.active = !rule.active;
  saveRules(rules);
  res.json({ toggled: true, active: rule.active });
});

// Eliminar regla
app.delete("/rules/:id", (req, res) => {
  let rules = loadRules();
  rules = rules.filter((r) => r.id !== req.params.id);
  saveRules(rules);
  res.json({ deleted: true });
});

// Test manual de una regla
app.post("/rules/test", async (req, res) => {
  const { event } = req.body;
  const matched = await evaluateRules(event);
  res.json({ matched: matched.length, rules: matched.map((r) => r.name) });
});

// Health check
app.get("/health", (req, res) => {
  const rules = loadRules();
  res.json({
    status: "ok",
    rules: rules.length,
    activeRules: rules.filter((r) => r.active).length,
    timestamp: new Date().toISOString(),
  });
});

// ─── INICIAR SERVIDOR ────────────────────────────────────────

const PORT = process.env.WEBHOOK_PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Remi Webhook Server corriendo en puerto ${PORT}`);
  console.log(`📋 Reglas activas: ${loadRules().filter((r) => r.active).length}`);
  console.log(`\nEndpoints disponibles:`);
  console.log(`  POST /webhook/ghl       → recibe eventos de GHL`);
  console.log(`  POST /webhook/whatsapp  → recibe mensajes de WhatsApp`);
  console.log(`  GET  /rules             → listar reglas`);
  console.log(`  POST /rules             → crear regla`);
  console.log(`  PUT  /rules/:id         → editar regla`);
  console.log(`  DELETE /rules/:id       → eliminar regla`);
  console.log(`  POST /rules/test        → probar regla con evento simulado`);
  console.log(`  GET  /health            → estado del servidor`);
});
