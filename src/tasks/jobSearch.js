// src/tasks/jobSearch.js — Tarea diaria de búsqueda de empleos remotos
import { scrapeJobs } from '../tools/scraper.js';
import { createCanvas, sendDM } from '../tools/slack.js';
import { appendJobs, ensureHeaders } from '../tools/sheets.js';

const SHEET_URL = `https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/edit`;

// Destinatarios
const RECIPIENTS = {
  destinatario: process.env.SLACK_JOBS_USER_ID,
};

export async function runJobSearch() {
  console.log('\n🎯 Iniciando búsqueda de empleos remotos...');
  const today = new Date().toLocaleDateString('es-CO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  let jobs = [];

  // ─── 1. Scraping ──────────────────────────────────────────────
  try {
    jobs = await scrapeJobs();
    console.log(`✅ ${jobs.length} empleos encontrados`);
  } catch (err) {
    console.error('❌ Error en scraping:', err.message);
    await sendDM(RECIPIENTS.destinatario, `⚠️ *Remi — Error en búsqueda de empleos*\nNo pude completar el scraping de hoy.\n\`${err.message}\``);
    return;
  }

  if (jobs.length === 0) {
    await sendDM(RECIPIENTS.destinatario, `⚠️ *Remi — Sin resultados hoy*\nNo encontré empleos que cumplan los filtros para ${today}.`);
    return;
  }

  // ─── 2. Google Sheets ─────────────────────────────────────────
  try {
    await ensureHeaders();
    await appendJobs(jobs);
  } catch (err) {
    console.warn('⚠️ Sheets falló (se continúa con Slack):', err.message);
  }

  // ─── 3. Construir Canvas ──────────────────────────────────────
  const canvasContent = buildCanvasContent(jobs, today);

  let canvasId;
  try {
    canvasId = await createCanvas(`🎯 Empleos Tu Academia — ${today}`, canvasContent);
    console.log(`✅ Canvas creado: ${canvasId}`);
  } catch (err) {
    console.error('❌ Error creando canvas:', err.message);
  }

  // ─── 4. Enviar a destinatario ──────────────────────────────────────────
  const canvasLink = canvasId ? `${process.env.SLACK_WORKSPACE_URL}/docs/${canvasId}` : '';
  const message = buildSlackMessage(jobs, today, canvasLink);

  try {
    await sendDM(RECIPIENTS.destinatario, message);
    console.log('✅ Mensaje enviado a destinatario');
  } catch (err) {
    console.error('❌ Error enviando a destinatario:', err.message);
  }

  console.log('✅ Tarea completada\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function buildCanvasContent(jobs, today) {
  let md = `# 🎯 Empleos Tu Academia — ${today}\n\n`;
  md += `> ${jobs.length} oportunidades 100% remotas en español\n\n`;

  jobs.forEach((job, i) => {
    const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'][i];
    md += `---\n\n## ${emoji} ${job.title}\n\n`;

    if (job.logo) {
      md += `![Logo ${job.company}](${job.logo})\n\n`;
    }

    md += `| Campo | Detalle |\n|---|---|\n`;
    md += `| 🏢 Empresa | ${job.company} |\n`;
    md += `| 📌 Sector | ${job.sector} |\n`;
    md += `| 🌐 Plataforma | ${job.platform} |\n`;
    md += `| 🕐 Publicado | ${job.publishedAt} |\n`;
    md += `| 💼 Modalidad | 100% Remoto |\n`;
    md += `| 🔗 Solicitar | [Aplicar aquí](${job.applyUrl}) |\n\n`;

    if (job.description) {
      md += `### 📋 Descripción\n${job.description}\n\n`;
    }
  });

  md += `---\n\n📊 [Ver base de datos completa](${`https://docs.google.com/spreadsheets/d/${process.env.GOOGLE_SHEET_ID}/edit`})\n`;
  return md;
}

function buildSlackMessage(jobs, today, canvasLink) {
  const titles = jobs.map((j, i) => `${['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣'][i]} *${j.title}* — ${j.company}`).join('\n');
  return `🎯 *Empleos Tu Academia — ${today}*\n\n${titles}\n\n${canvasLink ? `📋 Canvas completo con descripción e info:\n${canvasLink}` : ''}`;
}
