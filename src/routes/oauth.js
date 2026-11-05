// src/routes/oauth.js — OAuth flows: Google, Notion, Slack
import express from 'express';
import { readCreds, writeCreds } from './creds.js';

const router = express.Router();

const BASE_URL = () => process.env.PUBLIC_URL || 'http://localhost:3000';

// ─── STATE HELPERS ────────────────────────────────────────────────────────────

function encodeState(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function decodeState(str) {
  try { return JSON.parse(Buffer.from(str, 'base64url').toString()); } catch { return {}; }
}

function oauthSuccess(res, page, service, displayName) {
  const params = new URLSearchParams({ oauth: 'success', service });
  if (displayName) params.set('name', displayName);
  res.redirect(`/${page}.html?${params}`);
}

function oauthError(res, page, service, msg) {
  const params = new URLSearchParams({ oauth: 'error', service, msg: String(msg) });
  res.redirect(`/${page}.html?${params}`);
}

// ─── GOOGLE ───────────────────────────────────────────────────────────────────

router.get('/google/start', (req, res) => {
  const { userId, page = 'user' } = req.query;
  if (!userId) return res.status(400).send('userId requerido');

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return res.status(500).send('GOOGLE_CLIENT_ID no configurado');

  const state = encodeState({ userId, page });
  const redirect_uri = `${BASE_URL()}/api/oauth/google/callback`;
  const scopes = [
    'openid', 'email', 'profile',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets'
  ].join(' ');

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirect_uri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);

  res.redirect(url.toString());
});

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const { userId, page = 'user' } = decodeState(state || '');

  if (error || !code) {
    return oauthError(res, page || 'user', 'google', error || 'No se recibió code');
  }
  if (!userId) {
    return oauthError(res, page || 'user', 'google', 'State inválido');
  }

  try {
    const redirect_uri = `${BASE_URL()}/api/oauth/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri,
        grant_type:    'authorization_code'
      })
    });
    const tokens = await tokenRes.json();
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` }
    });
    const userInfo = await userRes.json();

    const creds = readCreds(userId);
    creds.google = {
      access_token:  tokens.access_token,
      refresh_token: tokens.refresh_token || creds.google?.refresh_token || null,
      expires_at:    Date.now() + (tokens.expires_in || 3600) * 1000,
      email:         userInfo.email,
      name:          userInfo.name,
      updatedAt:     new Date().toISOString()
    };
    writeCreds(userId, creds);

    oauthSuccess(res, page, 'google', encodeURIComponent(userInfo.email || userInfo.name || 'Google'));
  } catch (err) {
    console.error('[oauth] google callback error:', err.message);
    oauthError(res, page, 'google', err.message);
  }
});

// ─── NOTION ───────────────────────────────────────────────────────────────────

router.get('/notion/start', (req, res) => {
  const { userId, page = 'user' } = req.query;
  if (!userId) return res.status(400).send('userId requerido');

  const clientId = process.env.NOTION_CLIENT_ID;
  if (!clientId) return res.status(500).send('NOTION_CLIENT_ID no configurado');

  const state = encodeState({ userId, page });
  const redirect_uri = `${BASE_URL()}/api/oauth/notion/callback`;

  const url = new URL('https://api.notion.com/v1/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('owner', 'user');
  url.searchParams.set('redirect_uri', redirect_uri);
  url.searchParams.set('state', state);

  res.redirect(url.toString());
});

router.get('/notion/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const { userId, page = 'user' } = decodeState(state || '');

  if (error || !code) {
    return oauthError(res, page || 'user', 'notion', error || 'No se recibió code');
  }
  if (!userId) {
    return oauthError(res, page || 'user', 'notion', 'State inválido');
  }

  try {
    const redirect_uri = `${BASE_URL()}/api/oauth/notion/callback`;
    const credentials = Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString('base64');

    const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        grant_type:   'authorization_code',
        code,
        redirect_uri
      })
    });
    const data = await tokenRes.json();
    if (data.error) throw new Error(data.error_description || data.error);

    const creds = readCreds(userId);
    creds.notion = {
      access_token:    data.access_token,
      workspace_id:    data.workspace_id,
      workspace_name:  data.workspace_name,
      bot_id:          data.bot_id,
      owner_email:     data.owner?.user?.person?.email || null,
      updatedAt:       new Date().toISOString()
    };
    writeCreds(userId, creds);

    oauthSuccess(res, page, 'notion', encodeURIComponent(data.workspace_name || 'Notion'));
  } catch (err) {
    console.error('[oauth] notion callback error:', err.message);
    oauthError(res, page, 'notion', err.message);
  }
});

// ─── SLACK ────────────────────────────────────────────────────────────────────

router.get('/slack/start', (req, res) => {
  const { userId, page = 'user' } = req.query;
  if (!userId) return res.status(400).send('userId requerido');

  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) return res.status(500).send('SLACK_CLIENT_ID no configurado');

  const state = encodeState({ userId, page });
  const redirect_uri = `${BASE_URL()}/api/oauth/slack/callback`;
  const botScopes  = 'channels:read,channels:history,groups:read,groups:history,im:read,im:history,users:read,chat:write,files:read';
  const userScopes = 'identity.basic,identity.email';

  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', botScopes);
  url.searchParams.set('user_scope', userScopes);
  url.searchParams.set('redirect_uri', redirect_uri);
  url.searchParams.set('state', state);

  res.redirect(url.toString());
});

router.get('/slack/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const { userId, page = 'user' } = decodeState(state || '');

  if (error || !code) {
    return oauthError(res, page || 'user', 'slack', error || 'No se recibió code');
  }
  if (!userId) {
    return oauthError(res, page || 'user', 'slack', 'State inválido');
  }

  try {
    const redirect_uri = `${BASE_URL()}/api/oauth/slack/callback`;

    const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     process.env.SLACK_CLIENT_ID,
        client_secret: process.env.SLACK_CLIENT_SECRET,
        redirect_uri
      })
    });
    const data = await tokenRes.json();
    if (!data.ok) throw new Error(data.error || 'Slack token exchange failed');

    const creds = readCreds(userId);
    creds.slack = {
      bot_token:  data.access_token,
      team_id:    data.team?.id,
      team_name:  data.team?.name,
      user_id:    data.authed_user?.id,
      user_token: data.authed_user?.access_token || null,
      updatedAt:  new Date().toISOString()
    };
    writeCreds(userId, creds);

    oauthSuccess(res, page, 'slack', encodeURIComponent(data.team?.name || 'Slack'));
  } catch (err) {
    console.error('[oauth] slack callback error:', err.message);
    oauthError(res, page, 'slack', err.message);
  }
});

// ─── GOOGLE TOKEN REFRESH ─────────────────────────────────────────────────────

export async function refreshGoogleToken(userId) {
  const creds = readCreds(userId);
  if (!creds.google?.refresh_token) throw new Error('No hay refresh_token de Google para este usuario');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: creds.google.refresh_token,
      grant_type:    'refresh_token'
    })
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error_description || data.error);

  creds.google.access_token = data.access_token;
  creds.google.expires_at   = Date.now() + (data.expires_in || 3600) * 1000;
  creds.google.updatedAt    = new Date().toISOString();
  writeCreds(userId, creds);

  return data.access_token;
}

export async function getGoogleToken(userId) {
  const creds = readCreds(userId);
  if (!creds.google) throw new Error('Google no conectado para este usuario');

  // Auto-refresh if expires within 60 seconds
  if (!creds.google.expires_at || Date.now() > creds.google.expires_at - 60000) {
    return refreshGoogleToken(userId);
  }
  return creds.google.access_token;
}

export default router;
