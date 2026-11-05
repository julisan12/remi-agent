// tools/calendars.js
// Operaciones de calendarios y citas en GoHighLevel

import client, { locationId } from "../lib/ghl-client.js";

// Listar calendarios disponibles
export async function listCalendars() {
  const res = await client.get("/calendars/", {
    params: { locationId },
  });
  const calendars = res.data?.calendars || [];
  return {
    total: calendars.length,
    calendars: calendars.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      slug: c.slug,
      isActive: c.isActive,
    })),
  };
}

// Obtener slots disponibles de un calendario
export async function getAvailableSlots({ calendarId, startDate, endDate, timezone = "America/Mexico_City" }) {
  const res = await client.get(`/calendars/${calendarId}/free-slots`, {
    params: {
      startDate,
      endDate,
      timezone,
    },
  });
  return {
    calendarId,
    slots: res.data?.slots || [],
  };
}

// Crear una cita
export async function createAppointment({ calendarId, contactId, startTime, endTime, title, notes = "" }) {
  const res = await client.post("/calendars/events/appointments", {
    calendarId,
    locationId,
    contactId,
    startTime,
    endTime,
    title,
    notes,
    appointmentStatus: "confirmed",
  });
  return {
    created: true,
    appointment: res.data?.appointment,
  };
}

// Obtener citas de un contacto
export async function getContactAppointments({ contactId }) {
  const res = await client.get(`/contacts/${contactId}/appointments`);
  const appointments = res.data?.events || [];
  return {
    total: appointments.length,
    appointments: appointments.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.appointmentStatus,
      startTime: a.startTime,
      endTime: a.endTime,
      calendarId: a.calendarId,
      notes: a.notes,
    })),
  };
}

// Actualizar estado de una cita
export async function updateAppointmentStatus({ appointmentId, status }) {
  // status: confirmed | cancelled | showed | noshow | invalid
  const res = await client.put(`/calendars/events/appointments/${appointmentId}`, {
    appointmentStatus: status,
  });
  return {
    updated: true,
    appointmentId,
    newStatus: status,
  };
}
