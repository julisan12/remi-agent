// tools/conversations.js
// Operaciones de conversaciones y mensajes en GoHighLevel

import client, { locationId } from "../lib/ghl-client.js";

// Obtener conversaciones de un contacto
export async function getConversations({ contactId, limit = 5 }) {
  const res = await client.get("/conversations/search", {
    params: { locationId, contactId, limit },
  });
  const conversations = res.data?.conversations || [];
  return {
    total: conversations.length,
    conversations: conversations.map((c) => ({
      id: c.id,
      type: c.type,
      lastMessage: c.lastMessageBody,
      lastActivity: c.lastMessageDate,
      unread: c.unreadCount,
    })),
  };
}

// Obtener mensajes de una conversación
export async function getMessages({ conversationId, limit = 10 }) {
  const res = await client.get(`/conversations/${conversationId}/messages`, {
    params: { limit },
  });
  const messages = res.data?.messages || [];
  return {
    total: messages.length,
    messages: messages.map((m) => ({
      id: m.id,
      direction: m.direction, // inbound / outbound
      body: m.body,
      type: m.messageType,
      date: m.dateAdded,
    })),
  };
}

// Enviar template de WhatsApp (para ventana 24h cerrada)
export async function sendWhatsAppTemplate({ contactId, templateName, lang = "es", category = "MARKETING", bodyPlaceholders = [] }) {
  const message = bodyPlaceholders.length > 0
    ? `{{contact.first_name}}`
    : "";
  const res = await client.post("/conversations/messages", {
    contactId,
    locationId,
    type: "WhatsApp",
    MessageType: 19,
    whatsapp: {
      type: "template",
      template: { name: templateName, lang, category },
      placeholders: { header: [], body: bodyPlaceholders, buttons: [] },
    },
  });
  return { sent: true, messageId: res.data?.messageId };
}

// Enviar mensaje a un contacto
export async function sendMessage({ contactId, message, type = "SMS" }) {
  // Leer conversación reciente antes de enviar para evitar repetición
  const convs = await getConversations({ contactId, limit: 1 });
  let recentContext = null;
  if (convs.total > 0) {
    const msgs = await getMessages({ conversationId: convs.conversations[0].id, limit: 3 });
    recentContext = msgs.messages;
  }

  const res = await client.post("/conversations/messages", {
    type,
    contactId,
    locationId,
    message,
  });

  return {
    sent: true,
    messageId: res.data?.messageId,
    recentContext,
  };
}
