// src/lib/agent-tools.js
// Hub central: convierte tools.json a formato Anthropic + ejecuta herramientas MCP desde web chat
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TOOLS_JSON = path.join(__dirname, '../../memory/tools.json');

// ─── Importar handlers GHL ────────────────────────────────────────────────────
import * as ghlContacts      from '../../mcp/ghl/tools/contacts.js';
import * as ghlConversations from '../../mcp/ghl/tools/conversations.js';
import * as ghlOpportunities from '../../mcp/ghl/tools/opportunities.js';
import * as ghlWorkflows     from '../../mcp/ghl/tools/workflows.js';
import * as ghlCalendars     from '../../mcp/ghl/tools/calendars.js';
import * as ghlTagsNotes     from '../../mcp/ghl/tools/tags-notes-tasks.js';
import * as ghlLocation      from '../../mcp/ghl/tools/location.js';
import * as ghlBrowser       from '../../mcp/ghl/tools/browser.js';
import * as ghlAutomation    from '../../mcp/ghl/tools/automation.js';

// ─── Importar helpers Meta ────────────────────────────────────────────────────
import * as meta from './meta.js';

// ─── Importar Web browsing (Playwright) ──────────────────────────────────────
import * as webBrowser from './browser-web.js';

// ─── Importar WA ──────────────────────────────────────────────────────────────
import * as wa from './whatsapp.js';

// ─── Importar Task Manager ────────────────────────────────────────────────────
import { listScheduledTasks, createScheduledTask, toggleScheduledTask, deleteScheduledTask, runScheduledTaskNow } from './task-manager.js';

// ─── Importar Vault ───────────────────────────────────────────────────────────
import { readVaultFile, writeVaultFile, appendVaultFile } from './vault.js';

// ─── Mapa de tool_id → función handler ───────────────────────────────────────
const TOOL_HANDLERS = {
  // GHL — Contacts
  ghl_search_contact:   (i) => ghlContacts.searchContact(i),
  ghl_get_contact:      (i) => ghlContacts.getContact(i),
  ghl_create_contact:   (i) => ghlContacts.createContact(i),
  ghl_update_contact:   (i) => ghlContacts.updateContact(i),
  ghl_find_duplicates:  (i) => ghlContacts.findDuplicateContacts(i),
  // GHL — Conversations
  ghl_get_conversations: (i) => ghlConversations.getConversations(i),
  ghl_get_messages:      (i) => ghlConversations.getMessages(i),
  ghl_send_message:      (i) => ghlConversations.sendMessage(i),
  // GHL — Opportunities
  ghl_list_pipelines:       (i) => ghlOpportunities.listPipelines(i),
  ghl_list_opportunities:   (i) => ghlOpportunities.listOpportunities(i),
  ghl_create_opportunity:   (i) => ghlOpportunities.createOpportunity(i),
  ghl_move_opportunity:     (i) => ghlOpportunities.moveOpportunity(i),
  // GHL — Workflows
  ghl_list_workflows:           (i) => ghlWorkflows.listWorkflows(i),
  ghl_add_to_workflow:          (i) => ghlWorkflows.addContactToWorkflow(i),
  ghl_remove_from_workflow:     (i) => ghlWorkflows.removeContactFromWorkflow(i),
  // GHL — Calendars
  ghl_list_calendars:       (i) => ghlCalendars.listCalendars(i),
  ghl_get_slots:            (i) => ghlCalendars.getAvailableSlots(i),
  ghl_create_appointment:   (i) => ghlCalendars.createAppointment(i),
  ghl_get_appointments:     (i) => ghlCalendars.getContactAppointments(i),
  ghl_update_appointment:   (i) => ghlCalendars.updateAppointmentStatus(i),
  // GHL — Tags, Notes, Tasks
  ghl_add_tags:       (i) => ghlTagsNotes.addTagsToContact(i),
  ghl_remove_tags:    (i) => ghlTagsNotes.removeTagsFromContact(i),
  ghl_get_notes:      (i) => ghlTagsNotes.getContactNotes(i),
  ghl_create_note:    (i) => ghlTagsNotes.createContactNote(i),
  ghl_get_tasks:      (i) => ghlTagsNotes.getContactTasks(i),
  ghl_create_task:    (i) => ghlTagsNotes.createContactTask(i),
  ghl_complete_task:  (i) => ghlTagsNotes.completeTask(i),
  // GHL — Location
  ghl_list_users:         (i) => ghlLocation.listUsers(i),
  ghl_list_custom_fields: (i) => ghlLocation.listCustomFields(i),
  ghl_pipeline_summary:   (i) => ghlLocation.getPipelineSummary(i),
  ghl_get_unanswered:     (i) => ghlLocation.getUnansweredConversations(i),
  ghl_get_location_info:  (i) => ghlLocation.getLocationInfo(i),
  // WhatsApp
  wa_get_status:    (i) => wa.wa_get_status(i),
  wa_send_message:  (i) => wa.wa_send_message(i),
  wa_get_messages:  (i) => wa.wa_get_messages(i),
  wa_list_chats:    (i) => wa.wa_list_chats(i),
  // Meta
  meta_list_campaigns:       (i) => meta.meta_list_campaigns(i),
  meta_get_campaign:         (i) => meta.meta_get_campaign(i),
  meta_get_campaign_metrics: (i) => meta.meta_get_campaign_metrics(i),
  meta_get_account_metrics:  (i) => meta.meta_get_account_metrics(i),
  meta_list_adsets:          (i) => meta.meta_list_adsets(i),
  meta_get_adset_metrics:    (i) => meta.meta_get_adset_metrics(i),
  meta_list_ads:             (i) => meta.meta_list_ads(i),
  meta_pause_campaign:       (i) => meta.meta_pause_campaign(i),
  meta_activate_campaign:    (i) => meta.meta_activate_campaign(i),
  meta_edit_campaign_budget: (i) => meta.meta_edit_campaign_budget(i),
  meta_pause_adset:          (i) => meta.meta_pause_adset(i),
  meta_activate_adset:       (i) => meta.meta_activate_adset(i),
  meta_edit_adset_budget:    (i) => meta.meta_edit_adset_budget(i),
  meta_create_campaign:      (i) => meta.meta_create_campaign(i),
  meta_create_adset:         (i) => meta.meta_create_adset(i),
  meta_create_ad:            (i) => meta.meta_create_ad(i),
  meta_list_audiences:       (i) => meta.meta_list_audiences(i),
  meta_create_audience:      (i) => meta.meta_create_audience(i),
  meta_update_audience:      (i) => meta.meta_update_audience(i),
  meta_upload_image:         (i) => meta.meta_upload_image(i),
  meta_upload_video:         (i) => meta.meta_upload_video(i),
  meta_create_creative:      (i) => meta.meta_create_creative(i),
  meta_get_account_info:     (i) => meta.meta_get_account_info(i),
  // GHL — Browser automation (asíncrono via Python)
  ghl_browser_task:    (i) => ghlBrowser.runBrowserTask(i),
  ghl_browser_result:  ()  => ghlBrowser.getBrowserResult(),
  // Automatización / reglas
  automation_list_rules:     ()  => ghlAutomation.listRules(),
  automation_create_rule:    (i) => ghlAutomation.createRule(i),
  automation_toggle_rule:    (i) => ghlAutomation.toggleRule(i),
  automation_delete_rule:    (i) => ghlAutomation.deleteRule(i),
  automation_test_rule:      (i) => ghlAutomation.testRule(i),
  automation_webhook_status: ()  => ghlAutomation.getWebhookStatus(),
  // Tareas programadas
  list_scheduled_tasks:    ()  => listScheduledTasks(),
  create_scheduled_task:   (i) => createScheduledTask(i),
  toggle_scheduled_task:   (i) => toggleScheduledTask(i),
  delete_scheduled_task:   (i) => deleteScheduledTask(i),
  run_scheduled_task_now:  (i) => runScheduledTaskNow(i),
  // Vault Obsidian
  vault_read:    (i) => readVaultFile(i.path),
  vault_write:   (i) => writeVaultFile(i.path, i.content),
  vault_append:  (i) => appendVaultFile(i.path, i.content),
  // Web browsing (Playwright)
  web_navigate:    (i) => webBrowser.web_navigate(i),
  web_search:      (i) => webBrowser.web_search(i),
  web_read_page:   (i) => webBrowser.web_read_page(i),
  web_screenshot:  (i) => webBrowser.web_screenshot(i),
  web_click:       (i) => webBrowser.web_click(i),
  web_fill:        (i) => webBrowser.web_fill(i),
  web_evaluate:    (i) => webBrowser.web_evaluate(i),
  web_get_links:   (i) => webBrowser.web_get_links(i),
};

// ─── Mapa de agente → prefijos de tools que puede usar ───────────────────────
const AGENT_TOOL_PREFIXES = {
  'remi-main':      ['ghl_', 'wa_', 'meta_', 'automation_', 'list_scheduled', 'create_scheduled', 'toggle_scheduled', 'delete_scheduled', 'run_scheduled', 'vault_', 'web_'],
  'remi-crm':       ['ghl_', 'automation_'],
  'remi-ventas':    ['ghl_pipeline', 'ghl_list_opportunities', 'ghl_move', 'ghl_get_contact', 'ghl_search', 'ghl_add_tags', 'ghl_create_note', 'ghl_create_task', 'ghl_get_conversations', 'ghl_get_messages', 'ghl_send_message'],
  'remi-soporte':   ['wa_', 'ghl_get_unanswered', 'ghl_get_conversations', 'ghl_get_messages', 'ghl_send_message', 'ghl_search_contact', 'ghl_get_contact', 'ghl_add_tags', 'ghl_create_note'],
  'remi-marketing': ['meta_', 'web_search', 'web_read_page', 'web_navigate'],
  'remi-research':  ['web_', 'vault_read'],
  'remi-reportes':  ['ghl_pipeline_summary', 'ghl_list_opportunities', 'ghl_get_unanswered', 'meta_get_account_metrics', 'meta_list_campaigns', 'meta_get_campaign_metrics', 'list_scheduled', 'vault_read'],
};

// ─── Definiciones completas de tools MCP ─────────────────────────────────────
const FULL_MCP_TOOLS = [
  // ─── GHL extra (no en tools.json) ────────────────────────────────────────
  { name: 'ghl_list_pipelines',    description: 'Lista todos los pipelines disponibles en GHL.',      input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'ghl_create_opportunity',description: 'Crea una oportunidad en el pipeline.',                input_schema: { type: 'object', properties: { contactId:{type:'string'}, pipelineId:{type:'string'}, stageId:{type:'string'}, name:{type:'string'}, value:{type:'number'} }, required: ['contactId','pipelineId','stageId','name'] } },
  { name: 'ghl_list_workflows',    description: 'Lista todos los workflows de GHL.',                    input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'ghl_add_to_workflow',   description: 'Agrega contacto a un workflow.',                      input_schema: { type: 'object', properties: { contactId:{type:'string'}, workflowId:{type:'string'} }, required: ['contactId','workflowId'] } },
  { name: 'ghl_remove_from_workflow', description: 'Quita contacto de un workflow.',                   input_schema: { type: 'object', properties: { contactId:{type:'string'}, workflowId:{type:'string'} }, required: ['contactId','workflowId'] } },
  { name: 'ghl_list_calendars',    description: 'Lista calendarios disponibles en GHL.',               input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'ghl_get_slots',         description: 'Obtiene slots disponibles de un calendario.',         input_schema: { type: 'object', properties: { calendarId:{type:'string'}, startDate:{type:'string'}, endDate:{type:'string'}, timezone:{type:'string'} }, required: ['calendarId','startDate','endDate'] } },
  { name: 'ghl_get_appointments',  description: 'Obtiene citas de un contacto.',                       input_schema: { type: 'object', properties: { contactId:{type:'string'} }, required: ['contactId'] } },
  { name: 'ghl_update_appointment',description: 'Actualiza estado de una cita.',                       input_schema: { type: 'object', properties: { appointmentId:{type:'string'}, status:{type:'string',enum:['confirmed','cancelled','showed','noshow','invalid']} }, required: ['appointmentId','status'] } },
  { name: 'ghl_remove_tags',       description: 'Quita etiquetas de un contacto.',                    input_schema: { type: 'object', properties: { contactId:{type:'string'}, tags:{type:'string',description:'Tags separados por coma'} }, required: ['contactId','tags'] } },
  { name: 'ghl_get_notes',         description: 'Obtiene notas de un contacto.',                       input_schema: { type: 'object', properties: { contactId:{type:'string'} }, required: ['contactId'] } },
  { name: 'ghl_get_tasks',         description: 'Obtiene tareas asignadas a un contacto.',             input_schema: { type: 'object', properties: { contactId:{type:'string'} }, required: ['contactId'] } },
  { name: 'ghl_complete_task',     description: 'Marca una tarea como completada.',                    input_schema: { type: 'object', properties: { contactId:{type:'string'}, taskId:{type:'string'} }, required: ['contactId','taskId'] } },
  { name: 'ghl_list_users',        description: 'Lista los usuarios de la cuenta GHL.',               input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'ghl_list_custom_fields',description: 'Lista campos personalizados de contactos en GHL.',   input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'ghl_get_location_info', description: 'Obtiene info general de la sub-cuenta GHL.',         input_schema: { type: 'object', properties: {}, required: [] } },
  // ─── GHL — deduplicación ─────────────────────────────────────────────────
  { name: 'ghl_find_duplicates',   description: 'Busca contactos duplicados por nombre, email o teléfono.',  input_schema: { type: 'object', properties: { query:{type:'string',description:'Nombre, email o teléfono a buscar'} }, required: ['query'] } },
  // ─── GHL — Browser automation ─────────────────────────────────────────────
  { name: 'ghl_browser_task',   description: 'Lanza una tarea en GHL vía browser automation (Python). ⚠️ Tarda 5-12 min. Úsalo para acciones que no tienen API. Describe la tarea en lenguaje natural.',  input_schema: { type: 'object', properties: { tarea:{type:'string',description:'Descripción detallada de la tarea a ejecutar en GHL'} }, required: ['tarea'] } },
  { name: 'ghl_browser_result', description: 'Consulta el resultado de la última tarea de browser automation.',  input_schema: { type: 'object', properties: {}, required: [] } },
  // ─── Automatización / reglas ──────────────────────────────────────────────
  { name: 'automation_list_rules',     description: 'Lista todas las reglas de automatización activas.',         input_schema: { type:'object', properties:{}, required:[] } },
  { name: 'automation_create_rule',    description: 'Crea una nueva regla de automatización. ⚠️ Presenta propuesta primero.', input_schema: { type:'object', properties:{ name:{type:'string'}, conditions:{type:'array',items:{type:'object'}}, actions:{type:'array',items:{type:'object'}} }, required:['name','conditions','actions'] } },
  { name: 'automation_toggle_rule',    description: 'Activa o pausa una regla de automatización.',               input_schema: { type:'object', properties:{ ruleId:{type:'string'} }, required:['ruleId'] } },
  { name: 'automation_delete_rule',    description: 'Elimina una regla de automatización. ⚠️ Irreversible.',     input_schema: { type:'object', properties:{ ruleId:{type:'string'} }, required:['ruleId'] } },
  { name: 'automation_test_rule',      description: 'Prueba una regla con un evento simulado.',                   input_schema: { type:'object', properties:{ event:{type:'object',description:'Evento GHL de prueba (JSON)'} }, required:['event'] } },
  { name: 'automation_webhook_status', description: 'Verifica el estado del servidor de webhooks.',               input_schema: { type:'object', properties:{}, required:[] } },
  // ─── GHL — contacts / conversations / opportunities ───────────────────────
  { name: 'ghl_search_contact',    description: 'Busca contactos en GHL por nombre, email o teléfono.',input_schema: { type: 'object', properties: { query:{type:'string'} }, required: ['query'] } },
  { name: 'ghl_get_contact',       description: 'Obtiene los datos completos de un contacto por ID.',  input_schema: { type: 'object', properties: { contactId:{type:'string'} }, required: ['contactId'] } },
  { name: 'ghl_create_contact',    description: 'Crea un nuevo contacto en GHL.',                     input_schema: { type: 'object', properties: { firstName:{type:'string'}, lastName:{type:'string'}, email:{type:'string'}, phone:{type:'string'}, tags:{type:'string'} }, required: ['firstName'] } },
  { name: 'ghl_update_contact',    description: 'Actualiza campos de un contacto existente.',         input_schema: { type: 'object', properties: { contactId:{type:'string'}, fields:{type:'object'} }, required: ['contactId','fields'] } },
  { name: 'ghl_get_conversations', description: 'Obtiene conversaciones recientes de un contacto.',   input_schema: { type: 'object', properties: { contactId:{type:'string'}, limit:{type:'number'} }, required: ['contactId'] } },
  { name: 'ghl_get_messages',      description: 'Obtiene mensajes de una conversación.',              input_schema: { type: 'object', properties: { conversationId:{type:'string'}, limit:{type:'number'} }, required: ['conversationId'] } },
  { name: 'ghl_send_message',      description: 'Envía un mensaje a un contacto vía GHL.',            input_schema: { type: 'object', properties: { contactId:{type:'string'}, message:{type:'string'}, type:{type:'string'} }, required: ['contactId','message'] } },
  { name: 'ghl_list_opportunities',description: 'Lista oportunidades de un pipeline.',                input_schema: { type: 'object', properties: { pipelineId:{type:'string'}, stageId:{type:'string'}, limit:{type:'number'} }, required: ['pipelineId'] } },
  { name: 'ghl_move_opportunity',  description: 'Mueve una oportunidad a otra etapa del pipeline.',   input_schema: { type: 'object', properties: { opportunityId:{type:'string'}, newStageId:{type:'string'} }, required: ['opportunityId','newStageId'] } },
  { name: 'ghl_add_tags',          description: 'Agrega etiquetas a un contacto.',                    input_schema: { type: 'object', properties: { contactId:{type:'string'}, tags:{type:'string',description:'Tags separados por coma'} }, required: ['contactId','tags'] } },
  { name: 'ghl_create_note',       description: 'Crea una nota en un contacto.',                     input_schema: { type: 'object', properties: { contactId:{type:'string'}, body:{type:'string'} }, required: ['contactId','body'] } },
  { name: 'ghl_create_task',       description: 'Crea una tarea para un contacto.',                   input_schema: { type: 'object', properties: { contactId:{type:'string'}, title:{type:'string'}, body:{type:'string'}, dueDate:{type:'string'}, assignedTo:{type:'string'} }, required: ['contactId','title'] } },
  { name: 'ghl_create_appointment',description: 'Crea una cita en un calendario.',                   input_schema: { type: 'object', properties: { calendarId:{type:'string'}, contactId:{type:'string'}, startTime:{type:'string'}, endTime:{type:'string'}, title:{type:'string'}, notes:{type:'string'} }, required: ['calendarId','contactId','startTime','endTime','title'] } },
  { name: 'ghl_pipeline_summary',  description: 'Resumen del pipeline con conteo y valor por etapa.', input_schema: { type: 'object', properties: { pipelineId:{type:'string'} }, required: ['pipelineId'] } },
  { name: 'ghl_get_unanswered',    description: 'Lista conversaciones sin respuesta reciente.',       input_schema: { type: 'object', properties: { limit:{type:'number'} }, required: [] } },
  // ─── WhatsApp ─────────────────────────────────────────────────────────────
  { name: 'wa_get_status',    description: 'Verifica estado de conexión de WhatsApp.',            input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'wa_send_message',  description: 'Envía mensaje de WhatsApp. ⚠️ Requiere aprobación previa del usuario.', input_schema: { type: 'object', properties: { phone:{type:'string',description:'Número con código de país ej: +571234567890'}, message:{type:'string'} }, required: ['phone','message'] } },
  { name: 'wa_get_messages',  description: 'Lee mensajes recientes de un chat.',                  input_schema: { type: 'object', properties: { phone:{type:'string'}, limit:{type:'number'} }, required: ['phone'] } },
  { name: 'wa_list_chats',    description: 'Lista chats activos de WhatsApp.',                    input_schema: { type: 'object', properties: { limit:{type:'number'} }, required: [] } },
  // ─── Meta ─────────────────────────────────────────────────────────────────
  { name: 'meta_list_campaigns',       description: 'Lista campañas de Meta Ads.',                input_schema: { type:'object', properties:{ status:{type:'string',enum:['ACTIVE','PAUSED','ARCHIVED','ALL'],description:'Filtro por estado'} }, required:[] } },
  { name: 'meta_get_campaign',         description: 'Obtiene detalles de una campaña.',           input_schema: { type:'object', properties:{ campaignId:{type:'string'} }, required:['campaignId'] } },
  { name: 'meta_get_campaign_metrics', description: 'Métricas de rendimiento de una campaña.',   input_schema: { type:'object', properties:{ campaignId:{type:'string'}, datePreset:{type:'string',enum:['today','yesterday','last_7d','last_14d','last_30d','last_month','this_month']} }, required:['campaignId'] } },
  { name: 'meta_get_account_metrics',  description: 'Métricas generales de la cuenta publicitaria.', input_schema: { type:'object', properties:{ datePreset:{type:'string',enum:['today','yesterday','last_7d','last_14d','last_30d','last_month','this_month']} }, required:[] } },
  { name: 'meta_list_adsets',          description: 'Lista ad sets de una campaña.',              input_schema: { type:'object', properties:{ campaignId:{type:'string'} }, required:['campaignId'] } },
  { name: 'meta_get_adset_metrics',    description: 'Métricas de un ad set.',                     input_schema: { type:'object', properties:{ adsetId:{type:'string'}, datePreset:{type:'string'} }, required:['adsetId'] } },
  { name: 'meta_list_ads',             description: 'Lista anuncios de un ad set.',               input_schema: { type:'object', properties:{ adsetId:{type:'string'} }, required:['adsetId'] } },
  { name: 'meta_pause_campaign',       description: 'Pausa una campaña activa.',                  input_schema: { type:'object', properties:{ campaignId:{type:'string'} }, required:['campaignId'] } },
  { name: 'meta_activate_campaign',    description: 'Activa una campaña pausada.',                input_schema: { type:'object', properties:{ campaignId:{type:'string'} }, required:['campaignId'] } },
  { name: 'meta_edit_campaign_budget', description: 'Edita presupuesto diario de una campaña.',  input_schema: { type:'object', properties:{ campaignId:{type:'string'}, dailyBudget:{type:'number',description:'En centavos, ej: 1000=$10'} }, required:['campaignId','dailyBudget'] } },
  { name: 'meta_pause_adset',          description: 'Pausa un ad set.',                           input_schema: { type:'object', properties:{ adsetId:{type:'string'} }, required:['adsetId'] } },
  { name: 'meta_activate_adset',       description: 'Activa un ad set pausado.',                  input_schema: { type:'object', properties:{ adsetId:{type:'string'} }, required:['adsetId'] } },
  { name: 'meta_edit_adset_budget',    description: 'Edita presupuesto de un ad set.',            input_schema: { type:'object', properties:{ adsetId:{type:'string'}, dailyBudget:{type:'number'} }, required:['adsetId','dailyBudget'] } },
  { name: 'meta_list_audiences',       description: 'Lista audiencias personalizadas.',           input_schema: { type:'object', properties:{}, required:[] } },
  { name: 'meta_get_account_info',     description: 'Info general de la cuenta publicitaria.',    input_schema: { type:'object', properties:{}, required:[] } },
  // ─── Tareas programadas ───────────────────────────────────────────────────
  { name: 'list_scheduled_tasks',   description: 'Lista todas las tareas programadas de Remi con su estado, horario y última ejecución.', input_schema: { type:'object', properties:{}, required:[] } },
  { name: 'create_scheduled_task',  description: 'Crea una nueva tarea programada. schedule usa formato cron (ej: "0 9 * * 1-5" = L-V 9am). type puede ser "remi_prompt" o "job_search".', input_schema: { type:'object', properties:{ name:{type:'string'}, schedule:{type:'string',description:'Formato cron, ej: "0 9 * * 1-5"'}, description:{type:'string'}, type:{type:'string',enum:['remi_prompt','job_search']}, timezone:{type:'string',description:'ej: America/Caracas'}, config:{type:'object'} }, required:['name','schedule'] } },
  { name: 'toggle_scheduled_task',  description: 'Activa o pausa una tarea programada por su ID.', input_schema: { type:'object', properties:{ taskId:{type:'string'} }, required:['taskId'] } },
  { name: 'delete_scheduled_task',  description: 'Elimina permanentemente una tarea programada.', input_schema: { type:'object', properties:{ taskId:{type:'string'} }, required:['taskId'] } },
  { name: 'run_scheduled_task_now', description: 'Ejecuta inmediatamente una tarea programada sin esperar su horario.', input_schema: { type:'object', properties:{ taskId:{type:'string'} }, required:['taskId'] } },
  // ─── Vault Obsidian ───────────────────────────────────────────────────────
  { name: 'vault_read',   description: 'Lee un archivo del vault de Obsidian. path es relativo a vault/, ej: "usuarios/ejemplo/memoria.md"', input_schema: { type:'object', properties:{ path:{type:'string'} }, required:['path'] } },
  { name: 'vault_write',  description: 'Escribe/sobreescribe un archivo del vault. El cambio se sincroniza a GitHub y Obsidian desktop.', input_schema: { type:'object', properties:{ path:{type:'string'}, content:{type:'string'} }, required:['path','content'] } },
  { name: 'vault_append', description: 'Agrega contenido al final de un archivo del vault.', input_schema: { type:'object', properties:{ path:{type:'string'}, content:{type:'string'} }, required:['path','content'] } },
  // ─── Web browsing (Playwright) ────────────────────────────────────────────
  { name: 'web_navigate',   description: 'Navega a una URL y retorna el contenido de la página como texto limpio. Úsalo para leer páginas web, artículos, documentación, etc.',
    input_schema: { type:'object', properties:{ url:{type:'string',description:'URL completa incluyendo https://'}, waitFor:{type:'string',enum:['domcontentloaded','networkidle','load'],description:'Condición de espera (default: domcontentloaded)'} }, required:['url'] } },
  { name: 'web_search',     description: 'Busca en internet usando DuckDuckGo y retorna los resultados con título, URL y snippet. Usar para investigar, encontrar información actualizada, benchmarking.',
    input_schema: { type:'object', properties:{ query:{type:'string',description:'Términos de búsqueda'}, maxResults:{type:'number',description:'Máximo de resultados (default: 8)'} }, required:['query'] } },
  { name: 'web_read_page',  description: 'Lee el contenido completo de una URL con soporte de paginación. Más completo que web_navigate. Soporta offset para leer páginas largas en partes.',
    input_schema: { type:'object', properties:{ url:{type:'string'}, offset:{type:'number',description:'Caracter desde donde empezar (default: 0)'}, maxChars:{type:'number',description:'Máx caracteres por llamada (default: 12000)'} }, required:['url'] } },
  { name: 'web_screenshot', description: 'Toma un screenshot de la página actual o de una URL y retorna el link para verlo. Útil para verificar que una página carga correctamente.',
    input_schema: { type:'object', properties:{ url:{type:'string',description:'URL a capturar (opcional si ya hay página activa)'}, filename:{type:'string',description:'Nombre del archivo sin extensión'}, fullPage:{type:'boolean',description:'Captura página completa (default: false)'} }, required:[] } },
  { name: 'web_click',      description: 'Hace click en un elemento de la página activa. Requiere web_navigate previo.',
    input_schema: { type:'object', properties:{ selector:{type:'string',description:'CSS selector del elemento'}, text:{type:'string',description:'Texto visible del elemento (alternativa al selector)'}, waitMs:{type:'number',description:'Ms a esperar tras el click (default: 1500)'} }, required:[] } },
  { name: 'web_fill',       description: 'Rellena un campo de formulario en la página activa. Requiere web_navigate previo.',
    input_schema: { type:'object', properties:{ selector:{type:'string',description:'CSS selector del input'}, value:{type:'string',description:'Valor a escribir'}, pressEnter:{type:'boolean',description:'Presionar Enter al terminar (default: false)'} }, required:['selector','value'] } },
  { name: 'web_evaluate',   description: 'Ejecuta JavaScript en la página activa y retorna el resultado. Requiere web_navigate previo.',
    input_schema: { type:'object', properties:{ script:{type:'string',description:'Código JavaScript a evaluar en el contexto de la página'} }, required:['script'] } },
  { name: 'web_get_links',  description: 'Extrae todos los links de la página activa o de una URL. Útil para descubrir secciones de un sitio.',
    input_schema: { type:'object', properties:{ url:{type:'string',description:'URL a analizar (opcional si ya hay página activa)'}, filter:{type:'string',description:'Filtrar links que contengan este texto'} }, required:[] } },
  { name: 'meta_create_campaign',      description: 'Crea campaña en Meta Ads. ⚠️ Presenta propuesta al usuario primero.', input_schema: { type:'object', properties:{ name:{type:'string'}, objective:{type:'string'}, dailyBudget:{type:'number'}, status:{type:'string'} }, required:['name','objective'] } },
  { name: 'meta_create_adset',         description: 'Crea ad set. ⚠️ Presenta propuesta al usuario primero.', input_schema: { type:'object', properties:{ name:{type:'string'}, campaignId:{type:'string'}, dailyBudget:{type:'number'}, optimizationGoal:{type:'string'}, targeting:{type:'string'} }, required:['name','campaignId','dailyBudget','optimizationGoal','targeting'] } },
  { name: 'meta_create_ad',            description: 'Crea anuncio. ⚠️ Presenta propuesta al usuario primero.', input_schema: { type:'object', properties:{ name:{type:'string'}, adsetId:{type:'string'}, creativeId:{type:'string'} }, required:['name','adsetId','creativeId'] } },
  { name: 'meta_create_audience',      description: 'Crea audiencia personalizada. ⚠️ Presenta propuesta primero.', input_schema: { type:'object', properties:{ name:{type:'string'}, subtype:{type:'string'}, description:{type:'string'} }, required:['name','subtype'] } },
  { name: 'meta_update_audience',      description: 'Actualiza audiencia existente.',             input_schema: { type:'object', properties:{ audienceId:{type:'string'}, name:{type:'string'}, description:{type:'string'} }, required:['audienceId'] } },
  { name: 'meta_upload_image',         description: 'Sube imagen a la biblioteca de Meta Ads.',   input_schema: { type:'object', properties:{ imageUrl:{type:'string'}, name:{type:'string'} }, required:['imageUrl','name'] } },
  { name: 'meta_upload_video',         description: 'Sube video a la biblioteca de Meta Ads.',    input_schema: { type:'object', properties:{ videoUrl:{type:'string'}, name:{type:'string'}, description:{type:'string'} }, required:['videoUrl','name'] } },
  { name: 'meta_create_creative',      description: 'Crea creativo combinando asset, copy y CTA. ⚠️ Presenta propuesta primero.', input_schema: { type:'object', properties:{ name:{type:'string'}, type:{type:'string',enum:['image','video']}, assetId:{type:'string'}, primaryText:{type:'string'}, headline:{type:'string'}, callToAction:{type:'string'}, linkUrl:{type:'string'} }, required:['name','type','assetId','primaryText','headline','linkUrl'] } },
];

/**
 * Devuelve las tools Anthropic para un agente dado.
 * remi-main recibe todas; sub-agentes solo las de su área.
 */
export function getToolsForAgent(agentId) {
  const prefixes = AGENT_TOOL_PREFIXES[agentId];
  if (!prefixes) return [];

  if (agentId === 'remi-main') {
    return FULL_MCP_TOOLS;
  }

  return FULL_MCP_TOOLS.filter(t => prefixes.some(p => t.name.startsWith(p)));
}

/**
 * Ejecuta una tool MCP desde el web chat.
 * Devuelve string con resultado JSON.
 */
export async function executeAgentTool(toolName, input) {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) throw new Error(`Tool MCP desconocida: ${toolName}`);
  const result = await handler(input);
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}
