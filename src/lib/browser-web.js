// src/lib/browser-web.js
// Navegación web para Remi.
// Estrategia dual:
//   - HTTP mode (axios): web_search y web_read_page sin necesidad de browser binarios
//   - Playwright mode: web_navigate interactivo, web_click, web_fill, web_screenshot
// Si Playwright no está disponible, las tools básicas siguen funcionando.

import axios from 'axios';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, '../../public/screenshots');
const PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:3000';

// ─── Estado Playwright ────────────────────────────────────────────────────────
let _playwrightAvailable = null; // null = no comprobado aún
let _browser = null;
let _page = null;
let _idleTimer = null;
const IDLE_TIMEOUT = 8 * 60 * 1000;

async function checkPlaywright() {
  if (_playwrightAvailable !== null) return _playwrightAvailable;
  try {
    const { chromium } = await import('playwright');
    const b = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    await b.close();
    _playwrightAvailable = true;
  } catch {
    _playwrightAvailable = false;
    console.log('⚠️  browser-web: Playwright/chromium no disponible → modo HTTP activo');
  }
  return _playwrightAvailable;
}

function resetIdle() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(async () => {
    try { if (_browser) await _browser.close(); } catch {}
    _browser = null;
    _page = null;
  }, IDLE_TIMEOUT);
}

async function getPage() {
  const { chromium } = await import('playwright');
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
  }
  if (!_page || _page.isClosed()) {
    const ctx = await _browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'es-419'
    });
    _page = await ctx.newPage();
    await _page.route('**/*.{png,jpg,jpeg,gif,webp,svg,mp4,mp3,woff,woff2,ttf}', r => r.abort());
  }
  resetIdle();
  return _page;
}

// ─── Helpers HTTP ─────────────────────────────────────────────────────────────
const HTTP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-419,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br'
};

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{3,}/g, '  ')
    .replace(/\n{4,}/g, '\n\n')
    .trim();
}

async function httpGet(url, timeout = 20000) {
  const res = await axios.get(url, {
    headers: HTTP_HEADERS,
    timeout,
    maxRedirects: 5,
    responseType: 'text'
  });
  return res.data;
}

// ─── web_search ───────────────────────────────────────────────────────────────
export async function web_search({ query, maxResults = 8 }) {
  if (!query) throw new Error('query es requerido');

  // Intentar con Playwright si está disponible (mejor calidad)
  const hasPW = await checkPlaywright();
  if (hasPW) {
    try { return await _pwSearch(query, maxResults); } catch {}
  }

  // Fallback: DuckDuckGo Instant Answers API (JSON — no bloquea bots)
  const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
  try {
    const res = await axios.get(apiUrl, { headers: HTTP_HEADERS, timeout: 15000 });
    const data = res.data;
    const items = [];

    // Respuesta directa
    if (data.AbstractText) {
      items.push({ title: data.Heading || query, url: data.AbstractURL || '', snippet: data.AbstractText.slice(0, 250) });
    }

    // Topics relacionados
    for (const t of (data.RelatedTopics || []).slice(0, maxResults - items.length)) {
      if (t.Text && t.FirstURL) {
        items.push({ title: t.Text.slice(0, 80), url: t.FirstURL, snippet: t.Text.slice(0, 200) });
      } else if (t.Topics) {
        for (const sub of t.Topics.slice(0, 3)) {
          if (sub.Text && sub.FirstURL) {
            items.push({ title: sub.Text.slice(0, 80), url: sub.FirstURL, snippet: sub.Text.slice(0, 200) });
          }
        }
      }
    }

    if (items.length) {
      return `Resultados para: "${query}" (API DuckDuckGo)\n\n` +
        items.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
    }
  } catch {}

  return `No se encontraron resultados para: "${query}".\n\nSugerencia: instala Playwright en el servidor para búsquedas completas.`;
}

async function _pwSearch(query, maxResults) {
  const page = await getPage();
  await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=wt-wt`, { timeout: 15000, waitUntil: 'domcontentloaded' });
  const results = await page.evaluate((max) => {
    return Array.from(document.querySelectorAll('.result')).slice(0, max).map(el => {
      const a = el.querySelector('.result__a');
      const s = el.querySelector('.result__snippet');
      return { title: a?.innerText?.trim() || '', url: a?.href || '', snippet: s?.innerText?.trim() || '' };
    }).filter(r => r.title);
  }, maxResults);
  if (!results.length) return `No se encontraron resultados para: "${query}"`;
  return `Resultados para: "${query}" (${results.length})\n\n` +
    results.map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
}

// ─── web_navigate ─────────────────────────────────────────────────────────────
export async function web_navigate({ url, waitFor = 'domcontentloaded' }) {
  if (!url) throw new Error('url es requerido');

  const hasPW = await checkPlaywright();
  if (hasPW) {
    try {
      const page = await getPage();
      await page.goto(url, { timeout: 25000, waitUntil: waitFor });
      const title = await page.title();
      const text = await page.evaluate(() => {
        ['script','style','noscript','nav','footer','header','aside','iframe'].forEach(t =>
          document.querySelectorAll(t).forEach(el => el.remove()));
        return (document.body?.innerText || '').replace(/\n{4,}/g,'\n\n').trim();
      });
      const preview = text.length > 9000 ? text.slice(0, 9000) + '\n\n[...truncado]' : text;
      return `URL: ${page.url()}\nTitulo: ${title}\n\n${preview}`;
    } catch (err) {
      _page = null;
      console.error('PW navigate error, fallback HTTP:', err.message);
    }
  }

  // Fallback HTTP
  return await web_read_page({ url });
}

// ─── web_read_page ────────────────────────────────────────────────────────────
export async function web_read_page({ url, offset = 0, maxChars = 12000 }) {
  if (!url) throw new Error('url es requerido');
  const html = await httpGet(url, 25000);

  // Extraer título
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]).trim() : url;

  const text = stripHtml(html);
  const chunk = text.slice(offset, offset + maxChars);
  const hasMore = text.length > offset + maxChars;
  const next = hasMore ? `\n\n[Hay más. Llama con offset=${offset + maxChars} para continuar (${text.length} chars total)]` : '';
  return `Titulo: ${title}\nURL: ${url}\n\n${chunk}${next}`;
}

// ─── web_screenshot ───────────────────────────────────────────────────────────
export async function web_screenshot({ url, filename, fullPage = false }) {
  const hasPW = await checkPlaywright();
  if (!hasPW) return '⚠️ Screenshot no disponible: Playwright no está instalado en este servidor. Usa web_read_page para leer el contenido.';

  if (!existsSync(SCREENSHOTS_DIR)) mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const page = await getPage();
  if (url) await page.goto(url, { timeout: 25000, waitUntil: 'domcontentloaded' });
  const name = ((filename || `screenshot_${Date.now()}`).replace(/[^a-z0-9_-]/gi, '_')) + '.png';
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, name), fullPage });
  return `Screenshot guardado.\nURL: ${PUBLIC_URL}/screenshots/${name}\n\n(Abre el link en el navegador para verlo)`;
}

// ─── web_click ────────────────────────────────────────────────────────────────
export async function web_click({ selector, text: linkText, waitMs = 1500 }) {
  const hasPW = await checkPlaywright();
  if (!hasPW) return '⚠️ web_click requiere Playwright. Usa web_read_page + web_search para navegar sin browser.';
  const page = await getPage();
  resetIdle();
  if (linkText) {
    await page.getByText(linkText, { exact: false }).first().click({ timeout: 8000 });
  } else if (selector) {
    await page.click(selector, { timeout: 8000 });
  } else {
    throw new Error('Debes proporcionar selector o text');
  }
  await page.waitForTimeout(waitMs);
  return `Click realizado.\nPagina: ${await page.title()} (${page.url()})\n\n${(await page.evaluate(() => document.body?.innerText || '')).slice(0, 2000)}`;
}

// ─── web_fill ─────────────────────────────────────────────────────────────────
export async function web_fill({ selector, value, pressEnter = false }) {
  const hasPW = await checkPlaywright();
  if (!hasPW) return '⚠️ web_fill requiere Playwright instalado en el servidor.';
  const page = await getPage();
  resetIdle();
  await page.fill(selector, String(value), { timeout: 8000 });
  if (pressEnter) {
    await page.press(selector, 'Enter');
    await page.waitForTimeout(2000);
    return `Campo rellenado y Enter enviado. Pagina: ${await page.title()}`;
  }
  return `Campo "${selector}" rellenado con: "${value}"`;
}

// ─── web_evaluate ─────────────────────────────────────────────────────────────
export async function web_evaluate({ script }) {
  if (!script) throw new Error('script es requerido');
  const hasPW = await checkPlaywright();
  if (!hasPW) return '⚠️ web_evaluate requiere Playwright instalado en el servidor.';
  const page = await getPage();
  resetIdle();
  const result = await page.evaluate(script);
  return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
}

// ─── web_get_links ────────────────────────────────────────────────────────────
export async function web_get_links({ url, filter = '' }) {
  if (!url && !_page) throw new Error('Proporciona url o usa web_navigate primero');

  // Modo HTTP: extraer links del HTML sin browser
  if (url) {
    const html = await httpGet(url);
    const links = [];
    const regex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = regex.exec(html)) !== null) {
      const text = stripHtml(m[2]).replace(/\s+/g,' ').trim().slice(0, 80);
      if (text && m[1]) links.push({ text, href: m[1] });
    }
    const filtered = filter ? links.filter(l => l.text.toLowerCase().includes(filter.toLowerCase()) || l.href.includes(filter)) : links;
    const deduped = [...new Map(filtered.map(l => [l.href, l])).values()];
    return `${deduped.length} links en ${url}:\n\n` + deduped.slice(0, 40).map(l => `- ${l.text}\n  ${l.href}`).join('\n\n');
  }

  // Playwright si hay página activa
  const hasPW = await checkPlaywright();
  if (hasPW && _page && !_page.isClosed()) {
    const links = await _page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ text: a.innerText?.trim().replace(/\s+/g,' ').slice(0,80), href: a.href }))
        .filter(l => l.text && l.href.startsWith('http'))
    );
    const filtered = filter ? links.filter(l => l.text.toLowerCase().includes(filter.toLowerCase()) || l.href.includes(filter)) : links;
    return `${filtered.length} links:\n\n` + filtered.slice(0, 40).map(l => `- ${l.text}\n  ${l.href}`).join('\n\n');
  }

  throw new Error('Proporciona una url para extraer links');
}
