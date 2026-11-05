// tools/contacts.js
// Operaciones de contactos en GoHighLevel

import client, { locationId } from "../lib/ghl-client.js";

// Buscar contacto por nombre, email o teléfono
export async function searchContact({ query }) {
  const res = await client.get("/contacts/search", {
    params: { locationId, query },
  });
  const contacts = res.data?.contacts || [];
  if (contacts.length === 0) return { found: false, message: `No se encontró ningún contacto con: "${query}"` };
  return {
    found: true,
    total: contacts.length,
    contacts: contacts.slice(0, 5).map((c) => ({
      id: c.id,
      name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
      email: c.email,
      phone: c.phone,
      tags: c.tags,
    })),
  };
}

// Obtener datos completos de un contacto por ID
export async function getContact({ contactId }) {
  const res = await client.get(`/contacts/${contactId}`);
  const c = res.data?.contact;
  return {
    id: c.id,
    name: `${c.firstName || ""} ${c.lastName || ""}`.trim(),
    email: c.email,
    phone: c.phone,
    tags: c.tags,
    source: c.source,
    assignedTo: c.assignedTo,
    createdAt: c.dateAdded,
    customFields: c.customFields,
  };
}

// Crear nuevo contacto — siempre buscar antes de crear
export async function createContact({ firstName, lastName, email, phone, tags = [] }) {
  // Verificación previa de duplicado
  if (email || phone) {
    const query = email || phone;
    const check = await searchContact({ query });
    if (check.found) {
      return {
        created: false,
        warning: "Ya existe un contacto con ese email o teléfono.",
        existing: check.contacts[0],
      };
    }
  }
  const res = await client.post("/contacts/", {
    locationId,
    firstName,
    lastName,
    email,
    phone,
    tags,
  });
  return { created: true, contact: res.data?.contact };
}

// Actualizar datos de un contacto existente
export async function updateContact({ contactId, fields }) {
  const res = await client.put(`/contacts/${contactId}`, fields);
  return { updated: true, contact: res.data?.contact };
}

// Detectar contactos duplicados — agrupa por teléfono y email
export async function findDuplicateContacts({ query }) {
  // Busca contactos con ese dato y detecta si hay más de uno
  const res = await client.get("/contacts/search", {
    params: { locationId, query, pageSize: 20 },
  });
  const contacts = res.data?.contacts || [];
  if (contacts.length === 0) return { duplicates_found: false, message: `No se encontraron contactos con: "${query}"` };

  // Agrupar por teléfono
  const byPhone = {};
  const byEmail = {};
  for (const c of contacts) {
    const phone = c.phone?.replace(/\s/g, "");
    const email = c.email?.toLowerCase();
    if (phone) {
      byPhone[phone] = byPhone[phone] || [];
      byPhone[phone].push(c);
    }
    if (email) {
      byEmail[email] = byEmail[email] || [];
      byEmail[email].push(c);
    }
  }

  const duplicatesByPhone = Object.entries(byPhone)
    .filter(([, cs]) => cs.length > 1)
    .map(([phone, cs]) => ({
      phone,
      count: cs.length,
      contacts: cs.map((c) => ({ id: c.id, name: `${c.firstName || ""} ${c.lastName || ""}`.trim(), email: c.email, createdAt: c.dateAdded })),
    }));

  const duplicatesByEmail = Object.entries(byEmail)
    .filter(([, cs]) => cs.length > 1)
    .map(([email, cs]) => ({
      email,
      count: cs.length,
      contacts: cs.map((c) => ({ id: c.id, name: `${c.firstName || ""} ${c.lastName || ""}`.trim(), phone: c.phone, createdAt: c.dateAdded })),
    }));

  const totalDuplicates = duplicatesByPhone.length + duplicatesByEmail.length;

  return {
    duplicates_found: totalDuplicates > 0,
    total_contacts_scanned: contacts.length,
    duplicate_groups: totalDuplicates,
    by_phone: duplicatesByPhone,
    by_email: duplicatesByEmail,
    recommendation: totalDuplicates > 0
      ? "Revisar y fusionar manualmente en GHL → Contactos → seleccionar ambos → Merge"
      : "No se detectaron duplicados en este lote.",
  };
}
