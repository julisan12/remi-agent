// tools/opportunities.js
// Operaciones de oportunidades y pipelines en GoHighLevel

import client, { locationId } from "../lib/ghl-client.js";

// Listar pipelines disponibles
export async function listPipelines() {
  const res = await client.get("/opportunities/pipelines", {
    params: { locationId },
  });
  const pipelines = res.data?.pipelines || [];
  return {
    total: pipelines.length,
    pipelines: pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      stages: p.stages?.map((s) => ({ id: s.id, name: s.name })),
    })),
  };
}

// Listar oportunidades de un pipeline — con paginación automática
// NOTA: GHL filtra por status. Por defecto trae open+won+lost para coincidir con lo que muestra la UI de GHL.
export async function listOpportunities({ pipelineId, stageId = null, limit = 100, fetchAll = false, status = null }) {
  const statuses = status ? [status] : ['open', 'won', 'lost'];
  const allOpportunities = [];
  const pageSize = Math.min(limit, 100);

  for (const st of statuses) {
    let startAfterId = null;
    let totalInStatus = null;

    do {
      const params = { location_id: locationId, pipeline_id: pipelineId, limit: pageSize, status: st };
      if (startAfterId) params.startAfterId = startAfterId;

      const res = await client.get("/opportunities/search", { params });
      const page = res.data?.opportunities || [];
      if (totalInStatus === null) totalInStatus = res.data?.meta?.total ?? null;

      allOpportunities.push(...page);

      const hasMore = page.length === pageSize && allOpportunities.filter(o => o.status === st).length < (totalInStatus ?? Infinity);
      if (fetchAll && hasMore) {
        startAfterId = page[page.length - 1].id;
      } else {
        break;
      }
    } while (true);
  }

  // Si stageId se especificó, filtrar localmente (la API no lo soporta como parámetro)
  const filtered = stageId
    ? allOpportunities.filter(o => o.pipelineStageId === stageId)
    : allOpportunities;

  const byStatus = { open: 0, won: 0, lost: 0 };
  for (const o of filtered) byStatus[o.status] = (byStatus[o.status] || 0) + 1;

  return {
    total: filtered.length,
    byStatus,
    note: stageId ? `Filtrado localmente por stageId (API no soporta este filtro directo)` : null,
    opportunities: filtered.map((o) => ({
      id: o.id,
      name: o.name,
      contactId: o.contact?.id,
      contactName: o.contact?.name,
      contactPhone: o.contact?.phone,
      contactEmail: o.contact?.email,
      stage: o.pipelineStageId,
      status: o.status,
      value: o.monetaryValue,
      assignedTo: o.assignedTo,
      lastActivity: o.lastActivityAt,
    })),
  };
}

// Crear nueva oportunidad
export async function createOpportunity({ contactId, pipelineId, stageId, name, value = 0 }) {
  const res = await client.post("/opportunities/", {
    locationId,
    contactId,
    pipelineId,
    pipelineStageId: stageId,
    name,
    monetaryValue: value,
    status: "open",
  });
  return { created: true, opportunity: res.data?.opportunity };
}

// Mover oportunidad de etapa — verifica etapa actual primero
export async function moveOpportunity({ opportunityId, newStageId }) {
  // Verificar etapa actual antes de mover
  const res = await client.get(`/opportunities/${opportunityId}`);
  const current = res.data?.opportunity;
  if (current.pipelineStageId === newStageId) {
    return {
      moved: false,
      message: "La oportunidad ya está en esa etapa.",
      currentStage: current.pipelineStageId,
    };
  }
  const update = await client.put(`/opportunities/${opportunityId}`, {
    pipelineStageId: newStageId,
  });
  return {
    moved: true,
    from: current.pipelineStageId,
    to: newStageId,
    opportunity: update.data?.opportunity,
  };
}
