// src/tasks/seguimientoVentas.js
// Seguimiento diario de ventas — L-V 9am VET
// Por cada etapa configurada: envía WhatsApp a leads sin tag "seg-hoy", agrega el tag, reporta a asesor

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import client, { locationId } from '../../mcp/ghl/lib/ghl-client.js';
import { listOpportunities } from '../../mcp/ghl/tools/opportunities.js';
import { addTagsToContact } from '../../mcp/ghl/tools/tags-notes-tasks.js';
import { sendWhatsAppTemplate } from '../../mcp/ghl/tools/conversations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../config/mensajes-seguimiento.json');
const SLACK_VENTAS = process.env.SLACK_VENTAS_USER_ID;
const TAG_HOY = 'seg-hoy';

function log(msg) {
  console.log(`[SeguimientoVentas] ${msg}`);
}

async function notifySlack(channel, msg) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) return;
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, text: msg }),
    });
  } catch {}
}

async function getContactTags(contactId) {
  const res = await client.get(`/contacts/${contactId}`);
  return res.data?.contact?.tags || [];
}

function buildMessage(template, nombre) {
  return template.replace(/\{\{nombre\}\}/g, nombre || 'amigo/a');
}

export async function runSeguimientoVentas({ dryRun = false } = {}) {
  log(`Iniciando${dryRun ? ' [DRY RUN]' : ''}`);

  // Cargar configuración
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    log(`Error leyendo config: ${err.message}`);
    await notifySlack(SLACK_VENTAS, `❌ *SeguimientoVentas* — No se pudo cargar la configuración: \`${err.message}\``);
    return { ok: false, error: err.message };
  }

  const resumenLineas = [];
  let totalEnviados = 0;
  let totalSkipped = 0;
  let totalErrores = 0;

  for (const etapa of config.etapas) {
    const { pipelineId, stageId, stageName, mensaje } = etapa;
    log(`Procesando etapa: ${stageName}`);

    let opps;
    try {
      const result = await listOpportunities({ pipelineId, stageId, fetchAll: true, status: 'open' });
      opps = result.opportunities;
    } catch (err) {
      log(`Error listando oportunidades para ${stageName}: ${err.message}`);
      resumenLineas.push(`• *${stageName}*: ❌ Error listando leads`);
      totalErrores++;
      continue;
    }

    log(`${stageName}: ${opps.length} oportunidades encontradas`);

    let enviados = 0;
    let skipped = 0;
    let errores = 0;

    for (const opp of opps) {
      if (!opp.contactId) { skipped++; continue; }

      // Verificar si ya tiene el tag
      let tags;
      try {
        tags = await getContactTags(opp.contactId);
      } catch {
        errores++;
        continue;
      }

      if (tags.includes(TAG_HOY)) {
        skipped++;
        continue;
      }

      const nombre = opp.contactName?.split(' ')[0] || '';
      const texto = buildMessage(mensaje, nombre);

      if (dryRun) {
        log(`[DRY RUN] Enviaría template remi_seguimiento a ${opp.contactName} (${opp.contactPhone})`);
        enviados++;
        continue;
      }

      // Enviar template WhatsApp
      try {
        await sendWhatsAppTemplate({
          contactId: opp.contactId,
          templateName: 'remi_seguimiento',
          bodyPlaceholders: ['{{contact.first_name}}'],
        });
        log(`✓ Enviado a ${opp.contactName}`);
      } catch (err) {
        log(`Error enviando a ${opp.contactName}: ${err.message}`);
        errores++;
        continue;
      }

      // Agregar tag seg-hoy
      try {
        await addTagsToContact({ contactId: opp.contactId, tags: [TAG_HOY] });
      } catch (err) {
        log(`Error agregando tag a ${opp.contactName}: ${err.message}`);
      }

      enviados++;

      // Pequeña pausa para evitar rate limit
      await new Promise(r => setTimeout(r, 300));
    }

    totalEnviados += enviados;
    totalSkipped += skipped;
    totalErrores += errores;

    const lineaEtapa = `• *${stageName}*: ${enviados} enviados, ${skipped} ya tenían tag${errores > 0 ? `, ${errores} errores` : ''}`;
    resumenLineas.push(lineaEtapa);
    log(lineaEtapa);
  }

  const fecha = new Date().toLocaleDateString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric' });
  const prefijo = dryRun ? '🧪 *[DRY RUN] Seguimiento Ventas*' : '📊 *Seguimiento Ventas*';
  const resumen = [
    `${prefijo} — ${fecha}`,
    ...resumenLineas,
    `_Total: *${totalEnviados}* mensajes enviados${totalSkipped > 0 ? `, ${totalSkipped} ya gestionados` : ''}${totalErrores > 0 ? `, ${totalErrores} errores` : ''}_`,
  ].join('\n');

  log(resumen);
  await notifySlack(SLACK_VENTAS, resumen);

  return { ok: true, dryRun, stats: { enviados: totalEnviados, skipped: totalSkipped, errores: totalErrores } };
}
