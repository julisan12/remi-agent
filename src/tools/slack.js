// src/tools/slack.js — Integración Slack Web API
import { WebClient } from '@slack/web-api';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// Crear un Canvas standalone en Slack
export async function createCanvas(title, content) {
  const response = await slack.apiCall('canvases.create', {
    title,
    document_content: {
      type: 'markdown',
      markdown: content,
    },
  });

  if (!response.ok) throw new Error(`Slack Canvas error: ${response.error}`);
  return response.canvas_id;
}

// Enviar DM con link al canvas
export async function sendDM(userId, message) {
  const response = await slack.chat.postMessage({
    channel: userId,
    text: message,
    mrkdwn: true,
  });

  if (!response.ok) throw new Error(`Slack DM error: ${response.error}`);
  return response.ts;
}

// Obtener permalink de un canvas
export async function getCanvasLink(channelId, ts) {
  const response = await slack.chat.getPermalink({
    channel: channelId,
    message_ts: ts,
  });
  return response.permalink;
}
