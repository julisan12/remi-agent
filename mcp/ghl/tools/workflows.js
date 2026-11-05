// tools/workflows.js
// Operaciones de workflows en GoHighLevel
// NOTA: La API de GHL no permite CREAR workflows programáticamente.
// Remi puede listar, activar y agregar contactos a workflows existentes.

import client, { locationId } from "../lib/ghl-client.js";

// Listar todos los workflows disponibles
export async function listWorkflows() {
  const res = await client.get("/workflows/", {
    params: { locationId },
  });
  const workflows = res.data?.workflows || [];
  return {
    total: workflows.length,
    workflows: workflows.map((w) => ({
      id: w.id,
      name: w.name,
      status: w.status, // draft / published
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
    })),
  };
}

// Agregar un contacto a un workflow
export async function addContactToWorkflow({ contactId, workflowId }) {
  const res = await client.post(`/contacts/${contactId}/workflow/${workflowId}`, {
    eventStartTime: new Date().toISOString(),
  });
  return {
    added: true,
    contactId,
    workflowId,
    result: res.data,
  };
}

// Remover un contacto de un workflow
export async function removeContactFromWorkflow({ contactId, workflowId }) {
  const res = await client.delete(`/contacts/${contactId}/workflow/${workflowId}`);
  return {
    removed: true,
    contactId,
    workflowId,
  };
}
