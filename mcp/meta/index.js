// mcp/meta/index.js
// Servidor MCP de Meta Ads para Remi
// Requiere: META_ACCESS_TOKEN y META_AD_ACCOUNT_ID en config/.env

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import FormData from "form-data";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const __file = fileURLToPath(import.meta.url);

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../config/.env") });

const BASE_URL = "https://graph.facebook.com/v19.0";
const TOKEN = process.env.META_ACCESS_TOKEN;
const AD_ACCOUNT = process.env.META_AD_ACCOUNT_ID; // formato: act_XXXXXXXXX
const PAGE_ID = process.env.META_PAGE_ID;

const meta = axios.create({ baseURL: BASE_URL });
const params = (extra = {}) => ({ access_token: TOKEN, ...extra });

// ─── HELPERS ─────────────────────────────────────────────────

async function metaGet(path, query = {}) {
  const res = await meta.get(path, { params: params(query) });
  return res.data;
}

async function metaPost(path, body = {}) {
  const res = await meta.post(path, { ...body, access_token: TOKEN });
  return res.data;
}

// ─── SERVIDOR MCP ─────────────────────────────────────────────

export function createServer() {
const server = new McpServer({ name: "remi-meta", version: "1.0.0" });

// CAMPAÑAS
server.tool("meta_list_campaigns", "Lista campañas de la cuenta publicitaria.",
  { status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED", "ALL"]).optional().default("ALL") },
  async ({ status }) => {
    const filtering = status !== "ALL" ? `[{"field":"effective_status","operator":"IN","value":["${status}"]}]` : undefined;
    const result = await metaGet(`/${AD_ACCOUNT}/campaigns`, {
      fields: "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time",
      ...(filtering && { filtering }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool("meta_get_campaign", "Obtiene detalles de una campaña específica.",
  { campaignId: z.string() },
  async ({ campaignId }) => {
    const result = await metaGet(`/${campaignId}`, {
      fields: "id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,bid_strategy",
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool("meta_get_campaign_metrics", "Métricas de rendimiento de una campaña.",
  {
    campaignId: z.string(),
    datePreset: z.enum(["today", "yesterday", "last_7d", "last_14d", "last_30d", "last_month", "this_month"]).optional().default("last_7d"),
  },
  async ({ campaignId, datePreset }) => {
    const result = await metaGet(`/${campaignId}/insights`, {
      fields: "impressions,clicks,spend,reach,ctr,cpc,cpm,cpp,actions,cost_per_action_type",
      date_preset: datePreset,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool("meta_get_account_metrics", "Métricas generales de toda la cuenta publicitaria.",
  {
    datePreset: z.enum(["today", "yesterday", "last_7d", "last_14d", "last_30d", "last_month", "this_month"]).optional().default("last_7d"),
  },
  async ({ datePreset }) => {
    const result = await metaGet(`/${AD_ACCOUNT}/insights`, {
      fields: "impressions,clicks,spend,reach,ctr,cpc,cpm,actions,cost_per_action_type",
      date_preset: datePreset,
      level: "account",
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// CONJUNTOS DE ANUNCIOS (AD SETS)
server.tool("meta_list_adsets", "Lista conjuntos de anuncios de una campaña.",
  { campaignId: z.string() },
  async ({ campaignId }) => {
    const result = await metaGet(`/${campaignId}/adsets`, {
      fields: "id,name,status,daily_budget,targeting,optimization_goal,bid_amount",
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool("meta_get_adset_metrics", "Métricas de un conjunto de anuncios.",
  {
    adsetId: z.string(),
    datePreset: z.enum(["today", "yesterday", "last_7d", "last_14d", "last_30d"]).optional().default("last_7d"),
  },
  async ({ adsetId, datePreset }) => {
    const result = await metaGet(`/${adsetId}/insights`, {
      fields: "impressions,clicks,spend,reach,ctr,cpc,actions",
      date_preset: datePreset,
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// ANUNCIOS
server.tool("meta_list_ads", "Lista anuncios de un conjunto de anuncios.",
  { adsetId: z.string() },
  async ({ adsetId }) => {
    const result = await metaGet(`/${adsetId}/ads`, {
      fields: "id,name,status,creative,effective_status",
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

// CONTROL DE CAMPAÑAS
server.tool("meta_pause_campaign", "Pausa una campaña activa.",
  { campaignId: z.string() },
  async ({ campaignId }) => {
    const result = await metaPost(`/${campaignId}`, { status: "PAUSED" });
    return { content: [{ type: "text", text: JSON.stringify({ paused: true, campaignId, result }, null, 2) }] };
  }
);

server.tool("meta_activate_campaign", "Activa una campaña pausada.",
  { campaignId: z.string() },
  async ({ campaignId }) => {
    const result = await metaPost(`/${campaignId}`, { status: "ACTIVE" });
    return { content: [{ type: "text", text: JSON.stringify({ activated: true, campaignId, result }, null, 2) }] };
  }
);

server.tool("meta_edit_campaign_budget", "Edita el presupuesto diario de una campaña.",
  {
    campaignId: z.string(),
    dailyBudget: z.number().describe("Presupuesto diario en centavos, ej: 1000 = $10.00"),
  },
  async ({ campaignId, dailyBudget }) => {
    const result = await metaPost(`/${campaignId}`, { daily_budget: dailyBudget });
    return { content: [{ type: "text", text: JSON.stringify({ updated: true, campaignId, newDailyBudget: dailyBudget, result }, null, 2) }] };
  }
);

server.tool("meta_pause_adset", "Pausa un conjunto de anuncios.",
  { adsetId: z.string() },
  async ({ adsetId }) => {
    const result = await metaPost(`/${adsetId}`, { status: "PAUSED" });
    return { content: [{ type: "text", text: JSON.stringify({ paused: true, adsetId, result }, null, 2) }] };
  }
);

server.tool("meta_activate_adset", "Activa un conjunto de anuncios pausado.",
  { adsetId: z.string() },
  async ({ adsetId }) => {
    const result = await metaPost(`/${adsetId}`, { status: "ACTIVE" });
    return { content: [{ type: "text", text: JSON.stringify({ activated: true, adsetId, result }, null, 2) }] };
  }
);

server.tool("meta_edit_adset_budget", "Edita el presupuesto diario de un conjunto de anuncios.",
  {
    adsetId: z.string(),
    dailyBudget: z.number().describe("Presupuesto diario en centavos, ej: 1000 = $10.00"),
  },
  async ({ adsetId, dailyBudget }) => {
    const result = await metaPost(`/${adsetId}`, { daily_budget: dailyBudget });
    return { content: [{ type: "text", text: JSON.stringify({ updated: true, adsetId, newDailyBudget: dailyBudget, result }, null, 2) }] };
  }
);

// CREACIÓN — REQUIERE PROPUESTA APROBADA POR EL USUARIO ANTES DE LLAMAR

server.tool(
  "meta_create_campaign",
  `Crea una campaña en Meta Ads.
   ⚠️ FLUJO OBLIGATORIO: Primero presenta propuesta estructurada al usuario y espera aprobación explícita. Solo llamar esta tool tras confirmación.
   Estado inicial siempre PAUSED salvo que el usuario indique lo contrario.`,
  {
    name: z.string().describe("Nombre descriptivo de la campaña"),
    objective: z.enum([
      "OUTCOME_AWARENESS",
      "OUTCOME_TRAFFIC",
      "OUTCOME_ENGAGEMENT",
      "OUTCOME_LEADS",
      "OUTCOME_APP_PROMOTION",
      "OUTCOME_SALES",
    ]).describe("Objetivo de la campaña"),
    dailyBudget: z.number().optional().describe("Presupuesto diario en centavos, ej: 1000 = $10.00"),
    lifetimeBudget: z.number().optional().describe("Presupuesto total en centavos (alternativa a dailyBudget)"),
    status: z.enum(["ACTIVE", "PAUSED"]).optional().default("PAUSED"),
    startTime: z.string().optional().describe("ISO 8601, ej: 2026-04-01T00:00:00-0500"),
    stopTime: z.string().optional().describe("ISO 8601, requerido si se usa lifetimeBudget"),
    bidStrategy: z.enum([
      "LOWEST_COST_WITHOUT_CAP",
      "LOWEST_COST_WITH_BID_CAP",
      "COST_CAP",
    ]).optional().default("LOWEST_COST_WITHOUT_CAP"),
  },
  async ({ name, objective, dailyBudget, lifetimeBudget, status, startTime, stopTime, bidStrategy }) => {
    const body = {
      name,
      objective,
      status,
      bid_strategy: bidStrategy,
      special_ad_categories: [],
      ...(dailyBudget && { daily_budget: dailyBudget }),
      ...(lifetimeBudget && { lifetime_budget: lifetimeBudget }),
      ...(startTime && { start_time: startTime }),
      ...(stopTime && { stop_time: stopTime }),
    };
    const result = await metaPost(`/${AD_ACCOUNT}/campaigns`, body);
    return { content: [{ type: "text", text: JSON.stringify({ created: true, campaignId: result.id, name, objective, status, result }, null, 2) }] };
  }
);

server.tool(
  "meta_create_adset",
  `Crea un conjunto de anuncios dentro de una campaña.
   ⚠️ FLUJO OBLIGATORIO: Primero presenta propuesta con targeting, presupuesto y optimización al usuario. Solo llamar tras confirmación.
   Estado inicial siempre PAUSED salvo indicación contraria.`,
  {
    name: z.string(),
    campaignId: z.string(),
    dailyBudget: z.number().describe("Presupuesto diario en centavos"),
    billingEvent: z.enum(["IMPRESSIONS", "LINK_CLICKS", "POST_ENGAGEMENT", "PAGE_LIKES", "APP_INSTALLS", "VIDEO_VIEWS", "COMPLETED_VIDEO_VIEWS", "THRUPLAY"]).default("IMPRESSIONS"),
    optimizationGoal: z.enum([
      "REACH", "LINK_CLICKS", "CONVERSIONS", "LEAD_GENERATION",
      "VIDEO_VIEWS", "THRUPLAY", "APP_INSTALLS", "LANDING_PAGE_VIEWS",
      "OFFSITE_CONVERSIONS", "VALUE",
    ]),
    targeting: z.string().describe("JSON string con configuración de targeting. Ej: '{\"geo_locations\":{\"countries\":[\"MX\"]},\"age_min\":25,\"age_max\":45}'"),
    status: z.enum(["ACTIVE", "PAUSED"]).optional().default("PAUSED"),
    bidAmount: z.number().optional().describe("Puja máxima en centavos (solo con estrategia de bid cap)"),
    startTime: z.string().optional().describe("ISO 8601"),
    endTime: z.string().optional().describe("ISO 8601"),
  },
  async ({ name, campaignId, dailyBudget, billingEvent, optimizationGoal, targeting, status, bidAmount, startTime, endTime }) => {
    const body = {
      name,
      campaign_id: campaignId,
      daily_budget: dailyBudget,
      billing_event: billingEvent,
      optimization_goal: optimizationGoal,
      targeting: JSON.parse(targeting),
      status,
      ...(bidAmount && { bid_amount: bidAmount }),
      ...(startTime && { start_time: startTime }),
      ...(endTime && { end_time: endTime }),
    };
    const result = await metaPost(`/${AD_ACCOUNT}/adsets`, body);
    return { content: [{ type: "text", text: JSON.stringify({ created: true, adsetId: result.id, name, campaignId, status, result }, null, 2) }] };
  }
);

server.tool(
  "meta_create_ad",
  `Crea un anuncio dentro de un ad set usando un creativo existente.
   ⚠️ FLUJO OBLIGATORIO: Presenta propuesta con nombre, ad set y creativo al usuario. Solo llamar tras confirmación.
   Para obtener IDs de creativos disponibles usa meta_list_ads en otro ad set o pide el creative_id al usuario.`,
  {
    name: z.string(),
    adsetId: z.string(),
    creativeId: z.string().describe("ID del creativo existente en la cuenta (formato: xxxxxxxxxxxxxxx)"),
    status: z.enum(["ACTIVE", "PAUSED"]).optional().default("PAUSED"),
  },
  async ({ name, adsetId, creativeId, status }) => {
    const body = {
      name,
      adset_id: adsetId,
      creative: { creative_id: creativeId },
      status,
    };
    const result = await metaPost(`/${AD_ACCOUNT}/ads`, body);
    return { content: [{ type: "text", text: JSON.stringify({ created: true, adId: result.id, name, adsetId, creativeId, status, result }, null, 2) }] };
  }
);

// AUDIENCIAS
server.tool("meta_list_audiences", "Lista audiencias personalizadas de la cuenta.",
  {},
  async () => {
    const result = await metaGet(`/${AD_ACCOUNT}/customaudiences`, {
      fields: "id,name,subtype,approximate_count,description",
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "meta_create_audience",
  `Crea una audiencia personalizada en la cuenta.
   ⚠️ FLUJO OBLIGATORIO: Presenta propuesta con nombre, tipo y descripción al usuario. Solo llamar tras confirmación.
   Tipos comunes: CUSTOM (lista de clientes), WEBSITE (pixel), APP (eventos de app).`,
  {
    name: z.string(),
    subtype: z.enum(["CUSTOM", "WEBSITE", "APP", "OFFLINE_CONVERSION", "LOOKALIKE", "ENGAGEMENT"]),
    description: z.string().optional(),
    customerFileSource: z.enum([
      "USER_PROVIDED_ONLY",
      "PARTNER_PROVIDED_ONLY",
      "BOTH_USER_AND_PARTNER_PROVIDED",
    ]).optional().describe("Requerido si subtype es CUSTOM"),
  },
  async ({ name, subtype, description, customerFileSource }) => {
    const body = {
      name,
      subtype,
      ...(description && { description }),
      ...(customerFileSource && { customer_file_source: customerFileSource }),
    };
    const result = await metaPost(`/${AD_ACCOUNT}/customaudiences`, body);
    return { content: [{ type: "text", text: JSON.stringify({ created: true, audienceId: result.id, name, subtype, result }, null, 2) }] };
  }
);

server.tool(
  "meta_update_audience",
  `Actualiza nombre o descripción de una audiencia existente.
   ⚠️ FLUJO OBLIGATORIO: Confirma con el usuario antes de ejecutar.`,
  {
    audienceId: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
  },
  async ({ audienceId, name, description }) => {
    const body = {
      ...(name && { name }),
      ...(description && { description }),
    };
    const result = await metaPost(`/${audienceId}`, body);
    return { content: [{ type: "text", text: JSON.stringify({ updated: true, audienceId, result }, null, 2) }] };
  }
);

// CREATIVOS

server.tool(
  "meta_upload_image",
  `Sube una imagen a la biblioteca de Meta Ads desde una URL pública (Google Drive, Dropbox, etc.).
   Devuelve el image_hash necesario para crear un creativo.
   Para Google Drive: asegúrate de que el archivo tenga acceso "Cualquiera con el enlace" y usa el link de descarga directa.`,
  {
    imageUrl: z.string().describe("URL pública directa a la imagen (JPG, PNG). En Drive: usar formato https://drive.google.com/uc?export=download&id=FILE_ID"),
    name: z.string().describe("Nombre descriptivo para identificar la imagen en la biblioteca"),
  },
  async ({ imageUrl, name }) => {
    const imageRes = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(imageRes.data);
    const form = new FormData();
    form.append("access_token", TOKEN);
    form.append("filename", buffer, { filename: `${name}.jpg`, contentType: imageRes.headers["content-type"] || "image/jpeg" });
    const result = await axios.post(`${BASE_URL}/${AD_ACCOUNT}/adimages`, form, {
      headers: form.getHeaders(),
    });
    const images = result.data.images;
    const imageHash = images[Object.keys(images)[0]].hash;
    return { content: [{ type: "text", text: JSON.stringify({ uploaded: true, imageHash, name, result: result.data }, null, 2) }] };
  }
);

server.tool(
  "meta_upload_video",
  `Sube un video a la biblioteca de Meta Ads desde una URL pública (Google Drive, etc.).
   Devuelve el video_id necesario para crear un creativo de video.
   Para Google Drive: usa el link de descarga directa con export=download.
   ⚠️ Videos grandes pueden tardar — Meta procesa el video de forma asíncrona.`,
  {
    videoUrl: z.string().describe("URL pública directa al video (MP4). En Drive: https://drive.google.com/uc?export=download&id=FILE_ID"),
    name: z.string().describe("Nombre descriptivo para identificar el video"),
    description: z.string().optional().describe("Descripción opcional del video"),
  },
  async ({ videoUrl, name, description }) => {
    const videoRes = await axios.get(videoUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(videoRes.data);
    const form = new FormData();
    form.append("access_token", TOKEN);
    form.append("name", name);
    if (description) form.append("description", description);
    form.append("source", buffer, { filename: `${name}.mp4`, contentType: "video/mp4" });
    const result = await axios.post(`${BASE_URL}/${AD_ACCOUNT}/advideos`, form, {
      headers: form.getHeaders(),
    });
    return { content: [{ type: "text", text: JSON.stringify({ uploaded: true, videoId: result.data.id, name, result: result.data }, null, 2) }] };
  }
);

server.tool(
  "meta_create_creative",
  `Ensambla un creativo de anuncio combinando un asset (imagen o video) con copy, headline, CTA y URL de destino.
   Devuelve el creative_id para usar en meta_create_ad.
   ⚠️ FLUJO OBLIGATORIO: Presenta la propuesta completa (copy, headline, CTA, URL) al usuario antes de ejecutar.
   Requiere tener previamente el image_hash (de meta_upload_image) o video_id (de meta_upload_video).`,
  {
    name: z.string().describe("Nombre interno del creativo"),
    type: z.enum(["image", "video"]).describe("Tipo de creativo"),
    assetId: z.string().describe("image_hash si type=image, video_id si type=video"),
    primaryText: z.string().describe("Texto principal del anuncio (el copy que aparece arriba)"),
    headline: z.string().describe("Título destacado (texto en negrita debajo de la imagen)"),
    description: z.string().optional().describe("Descripción adicional (texto pequeño)"),
    callToAction: z.enum([
      "LEARN_MORE", "SIGN_UP", "CONTACT_US", "GET_QUOTE",
      "BOOK_TRAVEL", "DOWNLOAD", "APPLY_NOW", "SUBSCRIBE",
      "WATCH_MORE", "SHOP_NOW",
    ]).default("LEARN_MORE"),
    linkUrl: z.string().describe("URL de destino del anuncio"),
  },
  async ({ name, type, assetId, primaryText, headline, description, callToAction, linkUrl }) => {
    let objectStorySpec;
    if (type === "image") {
      objectStorySpec = {
        page_id: PAGE_ID,
        link_data: {
          image_hash: assetId,
          link: linkUrl,
          message: primaryText,
          name: headline,
          ...(description && { description }),
          call_to_action: { type: callToAction, value: { link: linkUrl } },
        },
      };
    } else {
      objectStorySpec = {
        page_id: PAGE_ID,
        video_data: {
          video_id: assetId,
          title: headline,
          message: primaryText,
          ...(description && { description }),
          call_to_action: { type: callToAction, value: { link: linkUrl } },
        },
      };
    }
    const body = { name, object_story_spec: objectStorySpec };
    const result = await metaPost(`/${AD_ACCOUNT}/adcreatives`, body);
    return { content: [{ type: "text", text: JSON.stringify({ created: true, creativeId: result.id, name, type, callToAction, linkUrl, result }, null, 2) }] };
  }
);

// INFORMACIÓN DE CUENTA
server.tool("meta_get_account_info", "Info general de la cuenta publicitaria.",
  {},
  async () => {
    const result = await metaGet(`/${AD_ACCOUNT}`, {
      fields: "id,name,account_status,currency,timezone_name,spend_cap,amount_spent,balance",
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

  return server;
}

// ─── INICIAR (solo cuando se ejecuta directamente) ───────────
if (process.argv[1] === __file) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
console.error("✅ Remi-Meta v2.0 activo — 23 tools disponibles");
