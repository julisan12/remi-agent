// tools/tags-notes-tasks.js
// Operaciones de tags, notas y tareas en GoHighLevel

import client, { locationId } from "../lib/ghl-client.js";

// ─── TAGS ────────────────────────────────────────────────────

// Agregar tags a un contacto
export async function addTagsToContact({ contactId, tags }) {
  const res = await client.post(`/contacts/${contactId}/tags`, { tags });
  return {
    added: true,
    contactId,
    tags,
    result: res.data,
  };
}

// Remover tags de un contacto
export async function removeTagsFromContact({ contactId, tags }) {
  const res = await client.delete(`/contacts/${contactId}/tags`, { data: { tags } });
  return {
    removed: true,
    contactId,
    tags,
  };
}

// ─── NOTAS ───────────────────────────────────────────────────

// Obtener notas de un contacto
export async function getContactNotes({ contactId }) {
  const res = await client.get(`/contacts/${contactId}/notes`);
  const notes = res.data?.notes || [];
  return {
    total: notes.length,
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      createdBy: n.userId,
      createdAt: n.dateAdded,
    })),
  };
}

// Crear nota en un contacto
export async function createContactNote({ contactId, body }) {
  const res = await client.post(`/contacts/${contactId}/notes`, {
    body,
    userId: "remi-agent",
  });
  return {
    created: true,
    note: res.data?.note,
  };
}

// ─── TAREAS ──────────────────────────────────────────────────

// Obtener tareas de un contacto
export async function getContactTasks({ contactId }) {
  const res = await client.get(`/contacts/${contactId}/tasks`);
  const tasks = res.data?.tasks || [];
  return {
    total: tasks.length,
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      body: t.body,
      status: t.completed ? "completed" : "pending",
      dueDate: t.dueDate,
      assignedTo: t.assignedTo,
    })),
  };
}

// Crear tarea para un contacto
export async function createContactTask({ contactId, title, body = "", dueDate, assignedTo = "" }) {
  const res = await client.post(`/contacts/${contactId}/tasks`, {
    title,
    body,
    dueDate,
    assignedTo,
    completed: false,
  });
  return {
    created: true,
    task: res.data?.task,
  };
}

// Marcar tarea como completada
export async function completeTask({ contactId, taskId }) {
  const res = await client.put(`/contacts/${contactId}/tasks/${taskId}/completed`, {
    completed: true,
  });
  return {
    completed: true,
    taskId,
  };
}
