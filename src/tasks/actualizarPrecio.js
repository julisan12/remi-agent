// src/tasks/actualizarPrecio.js
// Tarea diaria: obtiene tasa EUR del BCV, calcula precio Bs y actualiza custom value en GHL
// Corre a las 8:30pm VET diariamente

import https from 'https';
import client, { locationId } from '../../mcp/ghl/lib/ghl-client.js';

const SLACK_ALERTAS_CHANNEL = 'C0AMZ14JLJJ';
const PRECIO_BS_KEY = 'precio_bs';
const MULTIPLICADOR = 347;

function log(msg) {
  console.log(`[ActualizarPrecio] ${msg}`);
}

async function notifySlack(msg) {
  try {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) return;
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: SLACK_ALERTAS_CHANNEL, text: msg }),
    });
  } catch {}
}

// ─── Scraping BCV ──────────────────────────────────────────────────────────────
// BCV tiene cadena SSL incompleta — se usa https nativo con rejectUnauthorized: false
function fetchBCVPage() {
  return new Promise((resolve, reject) => {
    const req = https.get('https://www.bcv.org.ve/', {
      rejectUnauthorized: false,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Remi/1.0)' },
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, html: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('BCV timeout')); });
  });
}

async function getTasaEUR() {
  const { status, html } = await fetchBCVPage();
  if (status !== 200) throw new Error(`BCV HTTP ${status}`);

  // Estructura HTML: <div class="row recuadrotsmc">...<span> EUR </span>...<strong> 556,51900185 </strong>
  const bloques = html.split('recuadrotsmc');
  for (const bloque of bloques) {
    if (!/\bEUR\b/.test(bloque)) continue;
    const match = bloque.match(/<strong[^>]*>\s*([\d.,]+)\s*<\/strong>/);
    if (match) {
      // BCV usa coma como separador decimal (ej: "556,51900185")
      const valor = parseFloat(match[1].replace(',', '.'));
      if (!isNaN(valor) && valor > 0) return valor;
    }
  }
  throw new Error('No se encontró la tasa EUR en la página del BCV');
}

// ─── GHL Custom Values ─────────────────────────────────────────────────────────
async function getCustomValueByKey() {
  const res = await client.get(`/locations/${locationId}/customValues`);
  const values = res.data?.customValues || [];
  return values.find(
    (v) => v.fieldKey === PRECIO_BS_KEY || v.name?.toLowerCase() === 'precio bs'
  ) || null;
}

async function updateCustomValue(customValueId, valor) {
  await client.put(`/locations/${locationId}/customValues/${customValueId}`, {
    value: String(valor),
  });
}

// ─── Entrada principal ─────────────────────────────────────────────────────────
export async function runActualizarPrecio({ dryRun = false } = {}) {
  log(`Iniciando${dryRun ? ' [DRY RUN]' : ''}`);

  // 1. Obtener tasa EUR del BCV
  let tasaEUR;
  try {
    tasaEUR = await getTasaEUR();
    log(`Tasa EUR/BCV: ${tasaEUR}`);
  } catch (err) {
    const msg = `❌ *ActualizarPrecio* — No se pudo obtener la tasa BCV: \`${err.message}\``;
    log(msg);
    await notifySlack(msg);
    return { ok: false, error: err.message };
  }

  // 2. Calcular precio Bs
  const precioBs = Math.round(tasaEUR * MULTIPLICADOR);
  log(`Precio Bs calculado: ${tasaEUR} × ${MULTIPLICADOR} = ${precioBs}`);

  if (dryRun) {
    const msg = `🧪 *[DRY RUN] ActualizarPrecio*\nTasa EUR BCV: \`${tasaEUR}\`\nCálculo: ${tasaEUR} × ${MULTIPLICADOR} = *${precioBs} Bs*\n_Sin cambios en GHL_`;
    log(msg);
    await notifySlack(msg);
    return { ok: true, dryRun: true, tasaEUR, precioBs };
  }

  // 3. Buscar el custom value en GHL
  let customValue;
  try {
    customValue = await getCustomValueByKey();
    if (!customValue) throw new Error(`Custom value "${PRECIO_BS_KEY}" no encontrado en GHL`);
    log(`Custom value encontrado: ID ${customValue.id} (${customValue.name})`);
  } catch (err) {
    const msg = `❌ *ActualizarPrecio* — Error buscando custom value: \`${err.message}\``;
    log(msg);
    await notifySlack(msg);
    return { ok: false, error: err.message };
  }

  // 4. Actualizar en GHL
  try {
    await updateCustomValue(customValue.id, precioBs);
    const msg = `✅ *Precio Bs actualizado*\nTasa EUR BCV: \`${tasaEUR}\`\n${tasaEUR} × ${MULTIPLICADOR} = *${precioBs} Bs*\n_custom_values.precio_bs actualizado en GHL_`;
    log(msg);
    await notifySlack(msg);
    return { ok: true, tasaEUR, precioBs };
  } catch (err) {
    const msg = `❌ *ActualizarPrecio* — Error actualizando GHL: \`${err.message}\``;
    log(msg);
    await notifySlack(msg);
    return { ok: false, error: err.message };
  }
}
