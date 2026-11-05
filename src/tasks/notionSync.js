// src/tasks/notionSync.js — GHL "Acceso Entregado" → Google Sheets (Base de Datos)
// Se dispara via webhook cuando una oportunidad llega a la etapa de acceso

import { ensureStudentHeaders, appendStudent } from '../tools/sheets.js';

const GHL_TOKEN = process.env.GHL_CERT_API_TOKEN;
const GHL_LOC   = process.env.GHL_CERT_LOCATION_ID;

// ─── Etapas que disparan la sync (todas las variantes "Acceso entregado") ──
const ACCESO_STAGES = new Set([
  'b297679a-ee74-4b9f-86ac-5fc96395ad4f', // 16/03/26 CERTIFICACIÓN marzo  ← activo
  '7862dc2b-6721-49b9-abca-0acb177a0812', // 9/02/26 CERTIFICACIÓN
  '5a609ca2-a22a-47ff-8b48-53580993c6e8', // 14/01/26 certificación
  '1c2d26bd-b00b-4cfa-8b0a-d1facbad54a1', // 15/12/24 Certi Inter
  '947bed74-d106-47c7-b082-ca362b80cb2c', // 10/12/25 CERTIFICACIÓN INTER
  '1ca25ff8-fba9-49e8-84d1-c6d822391140', // CERTIFICACIÓN INTERNACIONAL
]);

// ─── Pipeline → Generación ─────────────────────────────────────────────────
const PIPELINE_GEN = {
  TU_PIPELINE_ID_1: 'Gen 16', // 16/03/26 CERTIFICACIÓN marzo
  TU_PIPELINE_ID_2: 'Gen 16', // 9/02/26 CERTIFICACIÓN
  TU_PIPELINE_ID_3: 'Gen 15', // 14/01/26 certificación
  TU_PIPELINE_ID_4: 'Gen 14', // 15/12/24 Certi Inter
  TU_PIPELINE_ID_5: 'Gen 14', // 10/12/25 CERTIFICACIÓN INTER
  TU_PIPELINE_ID_6: 'Gen 13', // CERTIFICACIÓN INTERNACIONAL
};

// ─── Mapeo de país (GHL código ISO o nombre) → opción en Notion ───────────
const COUNTRY_MAP = {
  CO: 'Colombia', AR: 'Argentina', MX: 'México', VE: 'Venezuela',
  PE: 'Perú',     CL: 'Chile',     EC: 'Ecuador', BO: 'Bolivia',
  PY: 'Paraguay', UY: 'Uruguay',   PA: 'Panamá',  CR: 'Costa Rica',
  GT: 'Guatemala',HN: 'Honduras',  SV: 'El Salvador', NI: 'Nicaragua',
  US: 'USA',      ES: 'España',    BR: 'Brasil',
  // nombres completos por si GHL los manda así
  COLOMBIA: 'Colombia', ARGENTINA: 'Argentina', MEXICO: 'México',
  VENEZUELA: 'Venezuela', PERU: 'Perú', CHILE: 'Chile',
};

const NOTION_COUNTRIES = new Set([
  'Argentina','Bolivia','Brasil','Canadá','Chile','Colombia','Costa Rica',
  'Ecuador','El Salvador','España','Guatemala','Honduras','México',
  'Nicaragua','Otro','Panamá','Paraguay','Perú','Uruguay','USA','Venezuela',
]);

function resolveCountry(raw) {
  if (!raw) return 'Otro';
  const key = raw.trim().toUpperCase().replace(/\s+/g, '_');
  if (COUNTRY_MAP[key]) return COUNTRY_MAP[key];
  // intentar match directo con opciones de Notion
  const title = raw.trim();
  if (NOTION_COUNTRIES.has(title)) return title;
  return 'Otro';
}

// ─── Detectar método de pago desde tags del contacto ──────────────────────
function resolveMetodoPago(tags = []) {
  const t = tags.map(x => x.toLowerCase()).join(' ');
  if (t.includes('hotmart'))                    return 'HOTMART';
  if (t.includes('binance') || t.includes('cripto')) return 'BINANCE';
  if (t.includes('zelle'))                      return 'ZELLE';
  if (t.includes('bancolombia'))                return 'BANCOLOMBIA';
  if (t.includes('pago movil') || t.includes('pago móvil') || t.includes('pagomovil')) return 'PAGO MÓVIL';
  if (t.includes('bold'))                       return 'BOLD';
  if (t.includes('pesos argentinos'))           return 'PESOS ARGENTINOS';
  return null;
}

// ─── Obtener contacto desde GHL ───────────────────────────────────────────
async function getContact(contactId) {
  const res = await fetch(
    `https://services.leadconnectorhq.com/contacts/${contactId}`,
    { headers: { Authorization: `Bearer ${GHL_TOKEN}`, Version: '2021-07-28' } }
  );
  if (!res.ok) throw new Error(`GHL contact ${contactId}: HTTP ${res.status}`);
  const data = await res.json();
  return data.contact || data;
}


// ─── Normalizar payload (GHL workflow vs webhook nativo) ──────────────────
// Workflow: manda campos planos  { contact_id, first_name, last_name, email, ... }
// Nativo:   manda { contactId, opportunity: { pipelineStageId, ... } }
function parsePayload(body) {
  // GHL manda el objeto opportunity como dato estándar junto con los campos del contacto
  const opp = body.opportunity || {};

  // Extraer stageId desde todas las ubicaciones posibles
  const stageId =
    body.pipeline_stage_id       ||   // custom data del workflow (campo plano)
    opp.pipelineStageId          ||   // objeto opportunity anidado (camelCase)
    opp.pipeline_stage_id        ||   // objeto opportunity anidado (snake_case)
    opp.stageId                  ||   // variante corta
    body.pipelineStageId         ||   // nativo raíz
    body.stageId                 || null;

  const pipelineId =
    body.pipeline_id             ||
    opp.pipelineId               ||
    opp.pipeline_id              ||
    body.pipelineId              || null;

  const contactId =
    body.contact_id              ||
    body.contactId               ||
    opp.contactId                || null;

  return {
    contactId,
    pipelineId,
    stageId,
    inline: body.contact_id ? {
      id:        body.contact_id,
      firstName: body.first_name  || body.firstName || '',
      lastName:  body.last_name   || body.lastName  || '',
      name:      body.full_name   || body.name      || '',
      email:     body.email       || '',
      phone:     body.phone       || body.phone_number || '',
      country:   body.country     || '',
      tags:      body.tags
                   ? (Array.isArray(body.tags) ? body.tags : body.tags.split(',').map(t => t.trim()))
                   : [],
    } : null,
  };
}

// ─── Handler principal — llamado desde el webhook ─────────────────────────
export async function handleAccesoEntregado(webhookBody) {
  console.log('📥 webhook/ghl-acceso payload completo:', JSON.stringify(webhookBody, null, 2));

  const { contactId, pipelineId, stageId, inline } = parsePayload(webhookBody);

  // Si viene del workflow de GHL (tiene contact_id plano), el stage ya fue filtrado
  // por el propio workflow — no necesitamos verificarlo aquí.
  // Si viene de webhook nativo, sí verificamos el stage.
  const isWorkflow = !!webhookBody.contact_id;
  if (!isWorkflow && !ACCESO_STAGES.has(stageId)) {
    return { skipped: true, stageId };
  }

  if (!contactId) {
    console.error('❌ notionSync: no contactId en payload', JSON.stringify(webhookBody));
    return { error: 'no contactId' };
  }

  console.log(`🎓 Acceso entregado → contactId: ${contactId} | pipeline: ${pipelineId}`);

  // Usar datos inline (workflow) o hacer llamada a GHL (webhook nativo)
  const contact = inline || await getContact(contactId);
  const nombre  = [contact.firstName, contact.lastName].filter(Boolean).join(' ')
                  || contact.name || 'Sin nombre';
  const gen     = PIPELINE_GEN[pipelineId] || 'Gen 16';
  const pais    = resolveCountry(contact.country);
  const metodo  = resolveMetodoPago(contact.tags || []);
  const hoy     = new Date().toISOString().split('T')[0];

  // Guardar en Google Sheets
  await ensureStudentHeaders();
  await appendStudent({
    id:               contactId,
    nombre,
    email:            contact.email    || '',
    telefono:         contact.phone    || '',
    pais,
    generacion:       gen,
    programa:         'Certificación Internacional',
    metodoPago:       metodo           || '',
    fechaInscripcion: hoy,
  });

  console.log(`✅ Estudiante registrado en Sheets: ${nombre} | Gen: ${gen}`);
  return { success: true, nombre, gen };
}
