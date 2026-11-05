// mcp/ghl/index.js
// Servidor MCP completo de GoHighLevel para Remi — v2.0

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { searchContact, getContact, createContact, updateContact, findDuplicateContacts } from "./tools/contacts.js";
import { getConversations, getMessages, sendMessage } from "./tools/conversations.js";
import { listPipelines, listOpportunities, createOpportunity, moveOpportunity } from "./tools/opportunities.js";
import { listWorkflows, addContactToWorkflow, removeContactFromWorkflow } from "./tools/workflows.js";
import { listCalendars, getAvailableSlots, createAppointment, getContactAppointments, updateAppointmentStatus } from "./tools/calendars.js";
import { addTagsToContact, removeTagsFromContact, getContactNotes, createContactNote, getContactTasks, createContactTask, completeTask } from "./tools/tags-notes-tasks.js";
import { listUsers, listCustomFields, getPipelineSummary, getUnansweredConversations, getLocationInfo } from "./tools/location.js";
import { runBrowserTask, getBrowserResult } from "./tools/browser.js";
import { listRules, createRule, updateRule, toggleRule, deleteRule, testRule, getWebhookStatus } from "./tools/automation.js";
import { createRuleFromText } from "./tools/automation-nl.js";
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

// ─── AUTO-CHECK: Playwright browsers ─────────────────────────
// Instala chromium en background si no está disponible.
// No bloquea el arranque del MCP — se lanza como proceso separado.
function ensurePlaywrightBrowserAsync() {
  const proc = spawn("npx", ["playwright", "install", "chromium"], {
    stdio: "ignore",
    detached: true,
    shell: process.platform === "win32",
  });
  proc.unref();
}

export function createServer() {
const server = new McpServer({ name: "remi-crm", version: "2.0.0" });

// CONTACTOS
server.tool("ghl_search_contact", "Busca contactos por nombre, email o teléfono. SIEMPRE usar antes de crear uno nuevo.",
  { query: z.string() },
  async ({ query }) => ({ content: [{ type: "text", text: JSON.stringify(await searchContact({ query }), null, 2) }] }));

server.tool("ghl_get_contact", "Datos completos de un contacto por ID.",
  { contactId: z.string() },
  async ({ contactId }) => ({ content: [{ type: "text", text: JSON.stringify(await getContact({ contactId }), null, 2) }] }));

server.tool("ghl_create_contact", "Crea contacto verificando duplicados automáticamente.",
  { firstName: z.string(), lastName: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), tags: z.array(z.string()).optional() },
  async (args) => ({ content: [{ type: "text", text: JSON.stringify(await createContact(args), null, 2) }] }));

server.tool("ghl_find_duplicates",
  "Detecta contactos duplicados buscando por teléfono, email o nombre. Agrupa los resultados y señala cuáles comparten el mismo dato. Usar para auditorías de base de datos.",
  { query: z.string().describe("Teléfono, email, nombre o fragmento a buscar") },
  async ({ query }) => ({ content: [{ type: "text", text: JSON.stringify(await findDuplicateContacts({ query }), null, 2) }] }));

server.tool("ghl_update_contact", "Actualiza datos de un contacto.",
  { contactId: z.string(), fields: z.object({ firstName: z.string().optional(), lastName: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), tags: z.array(z.string()).optional() }) },
  async ({ contactId, fields }) => ({ content: [{ type: "text", text: JSON.stringify(await updateContact({ contactId, fields }), null, 2) }] }));

// TAGS
server.tool("ghl_add_tags", "Agrega tags a un contacto.",
  { contactId: z.string(), tags: z.array(z.string()) },
  async ({ contactId, tags }) => ({ content: [{ type: "text", text: JSON.stringify(await addTagsToContact({ contactId, tags }), null, 2) }] }));

server.tool("ghl_remove_tags", "Remueve tags de un contacto.",
  { contactId: z.string(), tags: z.array(z.string()) },
  async ({ contactId, tags }) => ({ content: [{ type: "text", text: JSON.stringify(await removeTagsFromContact({ contactId, tags }), null, 2) }] }));

// NOTAS
server.tool("ghl_get_notes", "Obtiene notas de un contacto.",
  { contactId: z.string() },
  async ({ contactId }) => ({ content: [{ type: "text", text: JSON.stringify(await getContactNotes({ contactId }), null, 2) }] }));

server.tool("ghl_create_note", "Crea una nota en un contacto.",
  { contactId: z.string(), body: z.string() },
  async ({ contactId, body }) => ({ content: [{ type: "text", text: JSON.stringify(await createContactNote({ contactId, body }), null, 2) }] }));

// TAREAS
server.tool("ghl_get_tasks", "Obtiene tareas de un contacto.",
  { contactId: z.string() },
  async ({ contactId }) => ({ content: [{ type: "text", text: JSON.stringify(await getContactTasks({ contactId }), null, 2) }] }));

server.tool("ghl_create_task", "Crea una tarea para un contacto.",
  { contactId: z.string(), title: z.string(), body: z.string().optional(), dueDate: z.string().optional(), assignedTo: z.string().optional() },
  async (args) => ({ content: [{ type: "text", text: JSON.stringify(await createContactTask(args), null, 2) }] }));

server.tool("ghl_complete_task", "Marca una tarea como completada.",
  { contactId: z.string(), taskId: z.string() },
  async ({ contactId, taskId }) => ({ content: [{ type: "text", text: JSON.stringify(await completeTask({ contactId, taskId }), null, 2) }] }));

// CONVERSACIONES
server.tool("ghl_get_conversations", "Conversaciones recientes de un contacto.",
  { contactId: z.string(), limit: z.number().optional().default(5) },
  async ({ contactId, limit }) => ({ content: [{ type: "text", text: JSON.stringify(await getConversations({ contactId, limit }), null, 2) }] }));

server.tool("ghl_get_messages", "Mensajes de una conversación.",
  { conversationId: z.string(), limit: z.number().optional().default(10) },
  async ({ conversationId, limit }) => ({ content: [{ type: "text", text: JSON.stringify(await getMessages({ conversationId, limit }), null, 2) }] }));

server.tool("ghl_send_message", "Envía mensaje a un contacto (SMS, Email o WhatsApp).",
  { contactId: z.string(), message: z.string(), type: z.enum(["SMS", "Email", "WhatsApp"]).optional().default("SMS") },
  async ({ contactId, message, type }) => ({ content: [{ type: "text", text: JSON.stringify(await sendMessage({ contactId, message, type }), null, 2) }] }));

server.tool("ghl_get_unanswered", "Lista conversaciones sin respuesta. Para reportes de soporte.",
  { limit: z.number().optional().default(20) },
  async ({ limit }) => ({ content: [{ type: "text", text: JSON.stringify(await getUnansweredConversations({ limit }), null, 2) }] }));

// OPORTUNIDADES
server.tool("ghl_list_pipelines", "Lista pipelines con sus etapas.",
  {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(await listPipelines(), null, 2) }] }));

server.tool("ghl_list_opportunities",
  "Lista oportunidades de un pipeline. IMPORTANTE: siempre usa fetchAll:true para obtener TODOS los registros con paginación automática — sin esto solo obtienes los primeros 100 y los conteos serán incorrectos. Filtra por etapa con stageId (opcional). Incluye phone/email del contacto.",
  { pipelineId: z.string(), stageId: z.string().optional(), limit: z.number().optional().default(100), fetchAll: z.boolean().optional().default(true) },
  async ({ pipelineId, stageId, limit, fetchAll }) => ({ content: [{ type: "text", text: JSON.stringify(await listOpportunities({ pipelineId, stageId, limit, fetchAll }), null, 2) }] }));

server.tool("ghl_create_opportunity", "Crea una oportunidad en un pipeline.",
  { contactId: z.string(), pipelineId: z.string(), stageId: z.string(), name: z.string(), value: z.number().optional().default(0) },
  async (args) => ({ content: [{ type: "text", text: JSON.stringify(await createOpportunity(args), null, 2) }] }));

server.tool("ghl_move_opportunity", "Mueve una oportunidad a otra etapa.",
  { opportunityId: z.string(), newStageId: z.string() },
  async ({ opportunityId, newStageId }) => ({ content: [{ type: "text", text: JSON.stringify(await moveOpportunity({ opportunityId, newStageId }), null, 2) }] }));

server.tool("ghl_pipeline_summary", "Resumen completo de un pipeline: conteo por etapa, valor total y oportunidades estancadas (+7 días sin actividad). Pagina automáticamente todos los registros — úsalo para análisis rápido antes de ghl_list_opportunities.",
  { pipelineId: z.string() },
  async ({ pipelineId }) => ({ content: [{ type: "text", text: JSON.stringify(await getPipelineSummary({ pipelineId }), null, 2) }] }));

// WORKFLOWS
server.tool("ghl_list_workflows", "Lista workflows disponibles en la sub-cuenta.",
  {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(await listWorkflows(), null, 2) }] }));

server.tool("ghl_add_to_workflow", "Agrega un contacto a un workflow.",
  { contactId: z.string(), workflowId: z.string() },
  async ({ contactId, workflowId }) => ({ content: [{ type: "text", text: JSON.stringify(await addContactToWorkflow({ contactId, workflowId }), null, 2) }] }));

server.tool("ghl_remove_from_workflow", "Remueve un contacto de un workflow.",
  { contactId: z.string(), workflowId: z.string() },
  async ({ contactId, workflowId }) => ({ content: [{ type: "text", text: JSON.stringify(await removeContactFromWorkflow({ contactId, workflowId }), null, 2) }] }));

// CALENDARIOS
server.tool("ghl_list_calendars", "Lista calendarios disponibles.",
  {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(await listCalendars(), null, 2) }] }));

server.tool("ghl_get_slots", "Slots disponibles de un calendario.",
  { calendarId: z.string(), startDate: z.string(), endDate: z.string(), timezone: z.string().optional().default("America/Mexico_City") },
  async (args) => ({ content: [{ type: "text", text: JSON.stringify(await getAvailableSlots(args), null, 2) }] }));

server.tool("ghl_create_appointment", "Crea una cita para un contacto.",
  { calendarId: z.string(), contactId: z.string(), startTime: z.string(), endTime: z.string(), title: z.string(), notes: z.string().optional() },
  async (args) => ({ content: [{ type: "text", text: JSON.stringify(await createAppointment(args), null, 2) }] }));

server.tool("ghl_get_appointments", "Citas de un contacto.",
  { contactId: z.string() },
  async ({ contactId }) => ({ content: [{ type: "text", text: JSON.stringify(await getContactAppointments({ contactId }), null, 2) }] }));

server.tool("ghl_update_appointment", "Actualiza estado de una cita.",
  { appointmentId: z.string(), status: z.enum(["confirmed", "cancelled", "showed", "noshow", "invalid"]) },
  async ({ appointmentId, status }) => ({ content: [{ type: "text", text: JSON.stringify(await updateAppointmentStatus({ appointmentId, status }), null, 2) }] }));

// UBICACIÓN Y CONFIGURACIÓN
server.tool("ghl_list_users", "Lista usuarios de la sub-cuenta.",
  {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(await listUsers(), null, 2) }] }));

server.tool("ghl_list_custom_fields", "Lista campos personalizados de contactos.",
  {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(await listCustomFields(), null, 2) }] }));

server.tool("ghl_get_location_info", "Info general de la sub-cuenta.",
  {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(await getLocationInfo(), null, 2) }] }));


// ─── BROWSER AUTOMATION ──────────────────────────────────────
// Agrega este import junto a los demás imports al inicio del archivo:
// import { runBrowserTask, getBrowserResult } from "./tools/browser.js";

server.tool(
  "ghl_browser_task",
  `Ejecuta tareas en GHL que requieren navegación visual: crear/editar workflows, 
   configurar integraciones, editar funnels, cambiar configuraciones de UI. 
   USAR cuando la tarea NO se puede hacer via API.
   La tarea corre en background — usa ghl_browser_result para ver el resultado.
   Ejemplos: 'crea un workflow con trigger X y acción Y', 'edita el funnel Z'.`,
  {
    tarea: z.string().describe(
      "Descripción detallada de la tarea a ejecutar en GHL. " +
      "Incluir: qué hacer, parámetros específicos, si debe quedar en draft o publicado."
    ),
  },
  async ({ tarea }) => {
    try {
      const mensaje = await runBrowserTask({ tarea });
      return { content: [{ type: "text", text: mensaje }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `❌ Error iniciando browser: ${error.message}` }],
      };
    }
  }
);

server.tool(
  "ghl_browser_result",
  "Consulta el resultado de la última tarea de browser automation ejecutada.",
  {},
  async () => {
    try {
      const resultado = await getBrowserResult();
      return { content: [{ type: "text", text: resultado }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `❌ Error leyendo resultado: ${error.message}` }],
      };
    }
  }
);

// ─── AUTOMATIZACIÓN ──────────────────────────────────────────
server.tool("automation_list_rules", "Lista todas las reglas del motor de automatización.",
  {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(await listRules(), null, 2) }] }));

server.tool("automation_create_rule", "Crea una regla de automatización desde lenguaje natural. Ejemplo: 'cuando alguien escriba precio, responder con opciones de pago y etiquetar como prospecto'",
  { instruction: z.string().describe("Instrucción en lenguaje natural describiendo la regla") },
  async ({ instruction }) => ({ content: [{ type: "text", text: JSON.stringify(await createRuleFromText({ instruction }), null, 2) }] }));

server.tool("automation_toggle_rule", "Activa o pausa una regla existente.",
  { ruleId: z.string().describe("ID de la regla") },
  async ({ ruleId }) => ({ content: [{ type: "text", text: JSON.stringify(await toggleRule({ ruleId }), null, 2) }] }));

server.tool("automation_delete_rule", "Elimina una regla del motor.",
  { ruleId: z.string().describe("ID de la regla a eliminar") },
  async ({ ruleId }) => ({ content: [{ type: "text", text: JSON.stringify(await deleteRule({ ruleId }), null, 2) }] }));

server.tool("automation_test_rule", "Prueba las reglas con un evento simulado.",
  { event: z.object({ message: z.string(), contact: z.object({ name: z.string().optional(), phone: z.string().optional() }).optional() }).describe("Evento simulado") },
  async ({ event }) => ({ content: [{ type: "text", text: JSON.stringify(await testRule({ event }), null, 2) }] }));

server.tool("automation_webhook_status", "Verifica el estado del servidor de webhooks.",
  {},
  async () => ({ content: [{ type: "text", text: JSON.stringify(await getWebhookStatus(), null, 2) }] }));

  return server;
}

// ─── INICIAR (solo cuando se ejecuta directamente) ───────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // Verificar/instalar Playwright en background — no bloquea el arranque
  ensurePlaywrightBrowserAsync();

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("✅ Remi-CRM v2.0 activo — 30 tools disponibles");
}