// tools/location.js
// Operaciones de usuarios, configuración y reportes de la sub-cuenta

import client, { locationId } from "../lib/ghl-client.js";

// ─── USUARIOS ────────────────────────────────────────────────

// Listar usuarios de la sub-cuenta
export async function listUsers() {
  const res = await client.get("/users/search", {
    params: { locationId },
  });
  const users = res.data?.users || [];
  return {
    total: users.length,
    users: users.map((u) => ({
      id: u.id,
      name: `${u.firstName || ""} ${u.lastName || ""}`.trim(),
      email: u.email,
      role: u.roles?.type,
      phone: u.phone,
    })),
  };
}

// ─── CAMPOS PERSONALIZADOS ───────────────────────────────────

// Listar campos personalizados de contactos
export async function listCustomFields() {
  const res = await client.get("/locations/customFields", {
    params: { locationId, model: "contact" },
  });
  const fields = res.data?.customFields || [];
  return {
    total: fields.length,
    fields: fields.map((f) => ({
      id: f.id,
      name: f.name,
      fieldKey: f.fieldKey,
      dataType: f.dataType,
    })),
  };
}

// ─── REPORTES ────────────────────────────────────────────────

// Resumen de oportunidades por pipeline (para reportes de Remi)
export async function getPipelineSummary({ pipelineId }) {
  // Obtener nombres de etapas del pipeline
  const pipelineRes = await client.get("/opportunities/pipelines", { params: { locationId } });
  const pipeline = (pipelineRes.data?.pipelines || []).find(p => p.id === pipelineId);
  const stageMap = {};
  if (pipeline?.stages) {
    for (const s of pipeline.stages) stageMap[s.id] = s.name;
  }

  // Paginar todos los registros para cada status (GHL solo devuelve un status por llamada)
  const allOpportunities = [];
  for (const status of ['open', 'won', 'lost']) {
    let startAfterId = null;
    let totalInStatus = null;

    do {
      const params = { location_id: locationId, pipeline_id: pipelineId, limit: 100, status };
      if (startAfterId) params.startAfterId = startAfterId;

      const res = await client.get("/opportunities/search", { params });
      const page = res.data?.opportunities || [];
      if (totalInStatus === null) totalInStatus = res.data?.meta?.total ?? null;

      allOpportunities.push(...page);

      const countSoFar = allOpportunities.filter(o => o.status === status).length;
      const hasMore = page.length === 100 && countSoFar < (totalInStatus ?? Infinity);
      if (hasMore) {
        startAfterId = page[page.length - 1].id;
      } else {
        break;
      }
    } while (true);
  }

  // Agrupar por etapa con nombre legible
  const byStage = {};
  let totalValue = 0;

  for (const opp of allOpportunities) {
    const stageId = opp.pipelineStageId;
    const stageName = stageMap[stageId] || stageId;
    if (!byStage[stageName]) byStage[stageName] = { count: 0, value: 0, stageId };
    byStage[stageName].count++;
    byStage[stageName].value += opp.monetaryValue || 0;
    totalValue += opp.monetaryValue || 0;
  }

  const stale = allOpportunities.filter((o) => {
    const daysSince = (Date.now() - new Date(o.lastActivityAt)) / (1000 * 60 * 60 * 24);
    return daysSince > 7;
  });

  return {
    pipelineId,
    pipelineName: pipeline?.name || pipelineId,
    totalOpportunities: allOpportunities.length,
    totalValue,
    byStage,
    staleCount: stale.length,
    staleContacts: stale.slice(0, 10).map(o => ({
      name: o.contact?.name,
      stage: stageMap[o.pipelineStageId] || o.pipelineStageId,
      lastActivity: o.lastActivityAt,
    })),
  };
}

// Resumen de conversaciones sin respuesta
export async function getUnansweredConversations({ limit = 20 }) {
  const res = await client.get("/conversations/search", {
    params: { locationId, unread: true, limit },
  });
  const conversations = res.data?.conversations || [];
  return {
    total: conversations.length,
    conversations: conversations.map((c) => ({
      id: c.id,
      contactId: c.contactId,
      contactName: c.contactName,
      lastMessage: c.lastMessageBody,
      lastActivity: c.lastMessageDate,
      unreadCount: c.unreadCount,
      type: c.type,
    })),
  };
}

// Obtener info de la sub-cuenta
export async function getLocationInfo() {
  const res = await client.get(`/locations/${locationId}`);
  const loc = res.data?.location;
  return {
    id: loc.id,
    name: loc.name,
    email: loc.email,
    phone: loc.phone,
    address: loc.address,
    timezone: loc.timezone,
    currency: loc.currency,
  };
}
