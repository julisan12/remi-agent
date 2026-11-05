// src/tools/scraper.js — Playwright scraper para búsqueda de empleos
import { chromium } from 'playwright';

const SECTORS = [
  'ventas', 'asistente virtual', 'copywriter', 'soporte al cliente',
  'trafficker digital', 'closer de ventas', 'director comercial',
  'estratega marketing digital', 'chatters', 'arquitecto digital',
];

export async function scrapeJobs() {
  const browser = await chromium.launch({ headless: true });
  const jobs = [];

  try {
    console.log('🔍 Buscando en WeRemoto...');
    const weRemotoJobs = await scrapeWeRemoto(browser);
    jobs.push(...weRemotoJobs);

    if (jobs.length < 5) {
      console.log('🔍 Buscando en Computrabajo...');
      const computrabajoJobs = await scrapeComputrabajo(browser);
      jobs.push(...computrabajoJobs);
    }

    if (jobs.length < 5) {
      console.log('🔍 Buscando en LinkedIn...');
      const linkedinJobs = await scrapeLinkedIn(browser);
      jobs.push(...linkedinJobs);
    }
  } finally {
    await browser.close();
  }

  return jobs.slice(0, 5);
}

async function scrapeWeRemoto(browser) {
  const page = await browser.newPage();
  const jobs = [];

  const urls = [
    'https://weremoto.com/jobs?lang=es&category=ventas',
    'https://weremoto.com/jobs?lang=es&category=marketing',
    'https://weremoto.com/jobs?lang=es',
  ];

  for (const url of urls) {
    if (jobs.length >= 3) break;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(2000);

      const listings = await page.$$eval('a[href*="/jobs/"]', (els) =>
        els.slice(0, 10).map((el) => ({ href: el.href, text: el.innerText?.trim() }))
      );

      for (const listing of listings) {
        if (jobs.length >= 3) break;
        if (!listing.href || !listing.text) continue;

        try {
          const jobPage = await browser.newPage();
          await jobPage.goto(listing.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await jobPage.waitForTimeout(1500);

          const job = await jobPage.evaluate(() => {
            const title = document.querySelector('h1')?.innerText?.trim();
            const company = document.querySelector('[class*="company"], [class*="employer"]')?.innerText?.trim();
            const description = document.querySelector('[class*="description"], [class*="content"], article')?.innerText?.trim()?.slice(0, 800);
            const applyBtn = document.querySelector('a[href*="apply"], a[href*="solicitar"], a.apply-btn, [class*="apply"] a');
            const applyUrl = applyBtn?.href;
            const logo = document.querySelector('meta[property="og:image"]')?.content;
            return { title, company, description, applyUrl, logo };
          });

          if (job.title && job.applyUrl && !job.applyUrl.includes('weremoto.com/jobs')) {
            jobs.push({
              title: job.title,
              company: job.company || 'N/A',
              platform: 'WeRemoto',
              applyUrl: job.applyUrl,
              description: job.description || '',
              logo: job.logo || '',
              sector: detectSector(job.title),
              publishedAt: 'Reciente',
            });
          }
          await jobPage.close();
        } catch (e) {
          console.warn(`WeRemoto job error: ${e.message}`);
        }
      }
    } catch (e) {
      console.warn(`WeRemoto URL error: ${e.message}`);
    }
  }

  await page.close();
  return jobs;
}

async function scrapeComputrabajo(browser) {
  const page = await browser.newPage();
  const jobs = [];
  const queries = ['closer+ventas', 'asistente+virtual', 'trafficker+digital'];

  for (const q of queries) {
    if (jobs.length >= 3) break;
    try {
      await page.goto(
        `https://www.computrabajo.com/trabajo-de-trabajo-remoto?q=${q}`,
        { waitUntil: 'domcontentloaded', timeout: 20000 }
      );
      await page.waitForTimeout(2000);

      const listings = await page.$$eval('article[data-id], .js-o-link', (els) =>
        els.slice(0, 8).map((el) => ({
          href: el.querySelector('a')?.href || el.href,
          title: el.querySelector('h2, .fc_base')?.innerText?.trim(),
        }))
      );

      for (const listing of listings) {
        if (jobs.length >= 3) break;
        if (!listing.href) continue;

        try {
          const jobPage = await browser.newPage();
          await jobPage.goto(listing.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await jobPage.waitForTimeout(1500);

          const job = await jobPage.evaluate(() => {
            const title = document.querySelector('h1')?.innerText?.trim();
            const company = document.querySelector('[class*="company"], [itemprop="hiringOrganization"]')?.innerText?.trim();
            const description = document.querySelector('#descripcion_oferta, [class*="description"]')?.innerText?.trim()?.slice(0, 800);
            const applyBtn = document.querySelector('a.applyBtn, a[href*="solicitar"], .apply a');
            const applyUrl = applyBtn?.href;
            const logo = document.querySelector('meta[property="og:image"]')?.content;
            return { title, company, description, applyUrl, logo };
          });

          if (job.title) {
            jobs.push({
              title: job.title,
              company: job.company || 'N/A',
              platform: 'Computrabajo',
              applyUrl: job.applyUrl || listing.href,
              description: job.description || '',
              logo: job.logo || '',
              sector: detectSector(job.title),
              publishedAt: 'Reciente',
            });
          }
          await jobPage.close();
        } catch (e) {
          console.warn(`Computrabajo job error: ${e.message}`);
        }
      }
    } catch (e) {
      console.warn(`Computrabajo query error: ${e.message}`);
    }
  }

  await page.close();
  return jobs;
}

async function scrapeLinkedIn(browser) {
  const page = await browser.newPage();
  const jobs = [];
  const searches = [
    'https://www.linkedin.com/jobs/search/?keywords=closer+ventas+remoto&f_TPR=r172800&f_WT=2',
    'https://www.linkedin.com/jobs/search/?keywords=asistente+virtual+remoto&f_TPR=r172800&f_WT=2',
  ];

  for (const url of searches) {
    if (jobs.length >= 2) break;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(3000);

      const listings = await page.$$eval('.jobs-search__results-list li a', (els) =>
        els.slice(0, 6).map((el) => ({ href: el.href }))
      );

      for (const listing of listings) {
        if (jobs.length >= 2) break;
        if (!listing.href) continue;

        try {
          const jobPage = await browser.newPage();
          await jobPage.goto(listing.href, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await jobPage.waitForTimeout(2000);

          const job = await jobPage.evaluate(() => {
            const title = document.querySelector('.top-card-layout__title, h1')?.innerText?.trim();
            const company = document.querySelector('.topcard__org-name-link, .top-card-layout__second-subline')?.innerText?.trim();
            const description = document.querySelector('.description__text, .show-more-less-html__markup')?.innerText?.trim()?.slice(0, 800);
            const applyBtn = document.querySelector('.apply-button, a[data-tracking-control-name*="apply"]');
            const applyUrl = applyBtn?.href;
            const isEasyApply = document.querySelector('.jobs-apply-button--top-card') !== null;
            const logo = document.querySelector('meta[property="og:image"]')?.content;
            return { title, company, description, applyUrl, isEasyApply, logo };
          });

          if (job.title && !job.isEasyApply && job.applyUrl) {
            jobs.push({
              title: job.title,
              company: job.company || 'N/A',
              platform: 'LinkedIn',
              applyUrl: job.applyUrl,
              description: job.description || '',
              logo: job.logo || '',
              sector: detectSector(job.title),
              publishedAt: 'Reciente',
            });
          }
          await jobPage.close();
        } catch (e) {
          console.warn(`LinkedIn job error: ${e.message}`);
        }
      }
    } catch (e) {
      console.warn(`LinkedIn search error: ${e.message}`);
    }
  }

  await page.close();
  return jobs;
}

function detectSector(title = '') {
  const t = title.toLowerCase();
  for (const s of SECTORS) {
    if (t.includes(s)) return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return 'Ventas / Remoto';
}
