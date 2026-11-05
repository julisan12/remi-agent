// src/lib/vault.js
// Lectura/escritura del vault Obsidian con sync bidireccional vía GitHub API
// Web escribe → GitHub commit → Railway redeploya → Obsidian desktop git pull

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VAULT_DIR = path.join(__dirname, '../../vault');

function getGitHub() {
  return {
    token: process.env.GITHUB_TOKEN,
    repo:  process.env.GITHUB_REPO || 'julisan12/remi',
  };
}

// ─── Leer archivo del vault ───────────────────────────────────────────────────
export function readVaultFile(relativePath) {
  const fullPath = path.join(VAULT_DIR, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf8');
}

// ─── Escribir archivo del vault (local + GitHub commit) ──────────────────────
export async function writeVaultFile(relativePath, content) {
  // 1. Escribir en FS local (inmediato para la sesión actual)
  const fullPath = path.join(VAULT_DIR, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');

  // 2. Commit a GitHub para persistencia real y sync con Obsidian
  const { token, repo } = getGitHub();
  if (token && repo) {
    await _commitToGitHub(repo, token, `vault/${relativePath}`, content).catch(err =>
      console.error('[vault] GitHub sync error (non-fatal):', err.message)
    );
  }
}

// ─── Actualizar sección específica de un archivo .md ─────────────────────────
export async function updateVaultSection(relativePath, sectionHeader, newContent) {
  let current = readVaultFile(relativePath) || '';
  const sectionRegex = new RegExp(`(## ${sectionHeader}[\\s\\S]*?)(?=\\n## |$)`, 'i');
  const sectionBlock = `## ${sectionHeader}\n${newContent}\n`;

  if (sectionRegex.test(current)) {
    current = current.replace(sectionRegex, sectionBlock);
  } else {
    current += `\n${sectionBlock}`;
  }

  await writeVaultFile(relativePath, current);
}

// ─── Append a un archivo del vault ───────────────────────────────────────────
export async function appendVaultFile(relativePath, content) {
  let current = readVaultFile(relativePath) || '';
  await writeVaultFile(relativePath, current + '\n' + content);
}

// ─── Commit interno a GitHub API ─────────────────────────────────────────────
async function _commitToGitHub(repo, token, filePath, content) {
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  // Obtener SHA actual (necesario para actualizar archivos existentes)
  let sha;
  try {
    const getRes = await fetch(apiUrl, { headers });
    if (getRes.ok) {
      const data = await getRes.json();
      sha = data.sha;
    }
  } catch {}

  const body = {
    message: `[remi-web] sync ${filePath.split('/').pop()}`,
    content: Buffer.from(content).toString('base64'),
    ...(sha && { sha }),
  };

  const res = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API ${res.status}: ${err}`);
  }
}
