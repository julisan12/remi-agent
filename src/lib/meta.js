// src/lib/meta.js
// Helpers de Meta Ads — compartido entre MCP server y web chat
import axios from 'axios';
import FormData from 'form-data';

const BASE_URL = 'https://graph.facebook.com/v19.0';

function getToken() { return process.env.META_ACCESS_TOKEN; }
function getAdAccount() { return process.env.META_AD_ACCOUNT_ID; }
function getPageId() { return process.env.META_PAGE_ID; }

const metaClient = axios.create({ baseURL: BASE_URL });

export async function metaGet(path, query = {}) {
  const res = await metaClient.get(path, { params: { access_token: getToken(), ...query } });
  return res.data;
}

export async function metaPost(path, body = {}) {
  const res = await metaClient.post(path, { ...body, access_token: getToken() });
  return res.data;
}

// ─── CAMPAÑAS ─────────────────────────────────────────────────────────────────

export async function meta_list_campaigns({ status = 'ALL' } = {}) {
  const filtering = status !== 'ALL'
    ? `[{"field":"effective_status","operator":"IN","value":["${status}"]}]`
    : undefined;
  return metaGet(`/${getAdAccount()}/campaigns`, {
    fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time',
    ...(filtering && { filtering }),
  });
}

export async function meta_get_campaign({ campaignId }) {
  return metaGet(`/${campaignId}`, {
    fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,bid_strategy',
  });
}

export async function meta_get_campaign_metrics({ campaignId, datePreset = 'last_7d' }) {
  return metaGet(`/${campaignId}/insights`, {
    fields: 'impressions,clicks,spend,reach,ctr,cpc,cpm,cpp,actions,cost_per_action_type',
    date_preset: datePreset,
  });
}

export async function meta_get_account_metrics({ datePreset = 'last_7d' } = {}) {
  return metaGet(`/${getAdAccount()}/insights`, {
    fields: 'impressions,clicks,spend,reach,ctr,cpc,cpm,actions,cost_per_action_type',
    date_preset: datePreset,
    level: 'account',
  });
}

// ─── AD SETS ──────────────────────────────────────────────────────────────────

export async function meta_list_adsets({ campaignId }) {
  return metaGet(`/${campaignId}/adsets`, {
    fields: 'id,name,status,daily_budget,targeting,optimization_goal,bid_amount',
  });
}

export async function meta_get_adset_metrics({ adsetId, datePreset = 'last_7d' }) {
  return metaGet(`/${adsetId}/insights`, {
    fields: 'impressions,clicks,spend,reach,ctr,cpc,actions',
    date_preset: datePreset,
  });
}

// ─── ANUNCIOS ─────────────────────────────────────────────────────────────────

export async function meta_list_ads({ adsetId }) {
  return metaGet(`/${adsetId}/ads`, {
    fields: 'id,name,status,creative,effective_status',
  });
}

// ─── CONTROL DE CAMPAÑAS ──────────────────────────────────────────────────────

export async function meta_pause_campaign({ campaignId }) {
  const result = await metaPost(`/${campaignId}`, { status: 'PAUSED' });
  return { paused: true, campaignId, result };
}

export async function meta_activate_campaign({ campaignId }) {
  const result = await metaPost(`/${campaignId}`, { status: 'ACTIVE' });
  return { activated: true, campaignId, result };
}

export async function meta_edit_campaign_budget({ campaignId, dailyBudget }) {
  const result = await metaPost(`/${campaignId}`, { daily_budget: dailyBudget });
  return { updated: true, campaignId, newDailyBudget: dailyBudget, result };
}

export async function meta_pause_adset({ adsetId }) {
  const result = await metaPost(`/${adsetId}`, { status: 'PAUSED' });
  return { paused: true, adsetId, result };
}

export async function meta_activate_adset({ adsetId }) {
  const result = await metaPost(`/${adsetId}`, { status: 'ACTIVE' });
  return { activated: true, adsetId, result };
}

export async function meta_edit_adset_budget({ adsetId, dailyBudget }) {
  const result = await metaPost(`/${adsetId}`, { daily_budget: dailyBudget });
  return { updated: true, adsetId, newDailyBudget: dailyBudget, result };
}

// ─── CREACIÓN ─────────────────────────────────────────────────────────────────

export async function meta_create_campaign({
  name, objective, dailyBudget, lifetimeBudget,
  status = 'PAUSED', startTime, stopTime,
  bidStrategy = 'LOWEST_COST_WITHOUT_CAP'
}) {
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
  const result = await metaPost(`/${getAdAccount()}/campaigns`, body);
  return { created: true, campaignId: result.id, name, objective, status, result };
}

export async function meta_create_adset({
  name, campaignId, dailyBudget,
  billingEvent = 'IMPRESSIONS', optimizationGoal,
  targeting, status = 'PAUSED', bidAmount, startTime, endTime
}) {
  const body = {
    name,
    campaign_id: campaignId,
    daily_budget: dailyBudget,
    billing_event: billingEvent,
    optimization_goal: optimizationGoal,
    targeting: typeof targeting === 'string' ? JSON.parse(targeting) : targeting,
    status,
    ...(bidAmount && { bid_amount: bidAmount }),
    ...(startTime && { start_time: startTime }),
    ...(endTime && { end_time: endTime }),
  };
  const result = await metaPost(`/${getAdAccount()}/adsets`, body);
  return { created: true, adsetId: result.id, name, campaignId, status, result };
}

export async function meta_create_ad({ name, adsetId, creativeId, status = 'PAUSED' }) {
  const body = {
    name,
    adset_id: adsetId,
    creative: { creative_id: creativeId },
    status,
  };
  const result = await metaPost(`/${getAdAccount()}/ads`, body);
  return { created: true, adId: result.id, name, adsetId, creativeId, status, result };
}

// ─── AUDIENCIAS ───────────────────────────────────────────────────────────────

export async function meta_list_audiences() {
  return metaGet(`/${getAdAccount()}/customaudiences`, {
    fields: 'id,name,subtype,approximate_count,description',
  });
}

export async function meta_create_audience({ name, subtype, description, customerFileSource }) {
  const body = {
    name,
    subtype,
    ...(description && { description }),
    ...(customerFileSource && { customer_file_source: customerFileSource }),
  };
  const result = await metaPost(`/${getAdAccount()}/customaudiences`, body);
  return { created: true, audienceId: result.id, name, subtype, result };
}

export async function meta_update_audience({ audienceId, name, description }) {
  const body = {
    ...(name && { name }),
    ...(description && { description }),
  };
  const result = await metaPost(`/${audienceId}`, body);
  return { updated: true, audienceId, result };
}

// ─── CREATIVOS / ASSETS ───────────────────────────────────────────────────────

export async function meta_upload_image({ imageUrl, name }) {
  const imageRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(imageRes.data);
  const form = new FormData();
  form.append('access_token', getToken());
  form.append('filename', buffer, {
    filename: `${name}.jpg`,
    contentType: imageRes.headers['content-type'] || 'image/jpeg',
  });
  const result = await axios.post(`${BASE_URL}/${getAdAccount()}/adimages`, form, {
    headers: form.getHeaders(),
  });
  const images = result.data.images;
  const imageHash = images[Object.keys(images)[0]].hash;
  return { uploaded: true, imageHash, name, result: result.data };
}

export async function meta_upload_video({ videoUrl, name, description }) {
  const videoRes = await axios.get(videoUrl, { responseType: 'arraybuffer' });
  const buffer = Buffer.from(videoRes.data);
  const form = new FormData();
  form.append('access_token', getToken());
  form.append('name', name);
  if (description) form.append('description', description);
  form.append('source', buffer, { filename: `${name}.mp4`, contentType: 'video/mp4' });
  const result = await axios.post(`${BASE_URL}/${getAdAccount()}/advideos`, form, {
    headers: form.getHeaders(),
  });
  return { uploaded: true, videoId: result.data.id, name, result: result.data };
}

export async function meta_create_creative({
  name, type, assetId, primaryText, headline,
  description, callToAction = 'LEARN_MORE', linkUrl
}) {
  let objectStorySpec;
  if (type === 'image') {
    objectStorySpec = {
      page_id: getPageId(),
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
      page_id: getPageId(),
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
  const result = await metaPost(`/${getAdAccount()}/adcreatives`, body);
  return { created: true, creativeId: result.id, name, type, callToAction, linkUrl, result };
}

// ─── CUENTA ───────────────────────────────────────────────────────────────────

export async function meta_get_account_info() {
  return metaGet(`/${getAdAccount()}`, {
    fields: 'id,name,account_status,currency,timezone_name,spend_cap,amount_spent,balance',
  });
}
