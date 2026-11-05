// tools/automation-nl.js
// Permite a Remi crear reglas en lenguaje natural via Anthropic API

import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../config/.env") });

const anthropic = new Anthropic();
const WEBHOOK_PORT = process.env.WEBHOOK_PORT || 3001;
const BASE = `http://localhost:${WEBHOOK_PORT}`;

// Contexto de pipelines y etapas para que el modelo sepa qué IDs usar
const GHL_CONTEXT = `
Pipelines disponibles en GHL:

1. Distribución de Leads (id: TU_PIPELINE_ID)
   - nuevo lead (id: TU_STAGE_ID)
   - asesor (id: TU_STAGE_ID)
   - asesor (id: TU_STAGE_ID)
   - asesor (id: TU_STAGE_ID)
   - asesor (id: TU_STAGE_ID)
   - asesor (id: TU_STAGE_ID)

2. Reto Remoto (id: TU_PIPELINE_ID)
   - lead nuevo (id: TU_STAGE_ID)
   - Contactado (id: TU_STAGE_ID)
   - Interesado (id: TU_STAGE_ID)
   - Clic Compra (id: TU_STAGE_ID)
   - Compro (id: TU_STAGE_ID)
   - No Compro (id: TU_STAGE_ID)

3. Reto Remoto funnel principal (id: TU_PIPELINE_ID)
   - Lead Capturado (id: TU_STAGE_ID)
   - Lead Calificado (id: TU_STAGE_ID)
   - Página de Ventas Visitada (id: TU_STAGE_ID)
   - Carrito Abandonado (id: TU_STAGE_ID)
   - Comprador LATAM $19 (id: TU_STAGE_ID)
   - Comprador Premium $47 (id: TU_STAGE_ID)
   - Reto Activo (id: TU_STAGE_ID)
   - Reto Completado (id: TU_STAGE_ID)
   - Oportunidad Certificación $347 (id: TU_STAGE_ID)
   - Certificación Comprada (id: TU_STAGE_ID)
   - No Convertido — Nurture (id: TU_STAGE_ID)

Tipos de acciones disponibles:
- create_opportunity: crea oportunidad (requiere pipelineId, stageId, name)
- move_opportunity: mueve oportunidad (requiere stageId)
- send_message: envía mensaje (requiere message, channel: WhatsApp/SMS/Email)
- add_tags: agrega tags (requiere tags: array de strings)
- create_note: crea nota (requiere note)
- add_to_workflow: agrega a workflow (requiere workflowId)
- wait: espera (requiere seconds)
- log: registra en consola (requiere message)

Variables disponibles en mensajes y notas (usar con doble llave):
- {{contact.name}} — nombre del contacto
- {{contact.phone}} — teléfono
- {{contact.email}} — email
- {{message}} — mensaje recibido

Operadores de condición disponibles:
- contains: el campo contiene el valor
- equals: el campo es exactamente el valor
- not_equals: el campo no es el valor
- exists: el campo existe y no está vacío

Campos disponibles para condiciones:
- message: el mensaje recibido
- channel: canal (whatsapp, sms, email)
- contact.name: nombre del contacto
- contact.phone: teléfono del contacto
`;

export async function createRuleFromText({ instruction }) {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1000,
    system: `Eres un compilador de reglas de automatización para Remi, el agente de Tu Academia.
Tu tarea es convertir instrucciones en lenguaje natural a un objeto JSON de regla.
Responde SOLO con el JSON, sin explicaciones, sin markdown, sin bloques de código.

${GHL_CONTEXT}

Formato exacto que debes retornar:
{
  "name": "nombre descriptivo de la regla",
  "conditions": [
    {"field": "campo", "operator": "operador", "value": "valor"}
  ],
  "actions": [
    {"type": "tipo_accion", ...parametros}
  ]
}`,
    messages: [
      { role: "user", content: instruction }
    ],
  });

  const text = response.content[0].text.trim();

  let rule;
  try {
    rule = JSON.parse(text);
  } catch {
    throw new Error(`El modelo no retornó JSON válido: ${text}`);
  }

  // Guardar la regla via API del motor
  const res = await axios.post(`${BASE}/rules`, rule);
  return {
    created: true,
    rule: res.data.rule,
    message: `Regla "${rule.name}" creada y activa.`,
  };
}
