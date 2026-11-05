// src/routes/desktop.js — API para la app desktop de Remi
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { requireToken } from '../middleware/auth.js';
import { readCreds, writeCreds } from './creds.js';
import { getToolsForAgent, executeAgentTool } from '../lib/agent-tools.js';
import { initWhatsApp } from '../lib/whatsapp.js';
import { readVaultFile } from '../lib/vault.js';

// ─── Provider: OpenRouter (OpenAI-compatible) o Anthropic ────────────────────
const USE_OPENROUTER = !!process.env.OPENROUTER_API_KEY;
console.log(`🤖 LLM Provider: ${USE_OPENROUTER ? 'OpenRouter' : 'Anthropic'}`);

// Mapeo de modelos internos → OpenRouter
function toORModel(model) {
  if (model.includes('haiku')) return 'anthropic/claude-haiku-4-5';
  return 'anthropic/claude-sonnet-4-5';
}

// Convierte tools formato Anthropic → formato OpenAI
function toOpenAITools(tools) {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema || { type: 'object', properties: {}, required: [] }
    }
  }));
}

// Inicializar WhatsApp al arrancar el servidor (non-blocking)
initWhatsApp().catch(e => console.error('WA init:', e.message));

const __dirname_desktop = path.dirname(fileURLToPath(import.meta.url));
const VAULT_DIR   = path.join(__dirname_desktop, '../../vault');
const MEMORY_DIR  = path.join(__dirname_desktop, '../../memory');

const router = express.Router();

// ─── Agentes disponibles ──────────────────────────────────────────────────────
const AGENTS = {
  'remi-main': {
    name: 'Remi', emoji: '🐻‍❄️',
    model: 'claude-sonnet-4-6',
    systemPrompt: `Eres Remi, agente de inteligencia operativa de Tu Academia. Colaborador senior integrado a todas las áreas del negocio. Directo, analítico, propositivo, honesto aunque incomode. Español neutro, frases cortas, cero relleno. No eres un bot genérico ni complaciente.

CONTEXTO INSTITUCIONAL
Tu Academia — academia de formación para trabajo remoto.
Programas: ventas digitales, operaciones, marketing, IA aplicada.
Público: personas buscando trabajo remoto con estándares reales.
Modelo: 3 sesiones filtro gratuitas → ingreso completo. Puntualidad y entregables son parte del entrenamiento.
Equipo: (configura aquí tu equipo).

ÁREAS QUE DOMINAS
- CRM/GHL: contactos, pipelines, oportunidades, conversaciones, tareas
- Ventas: show rate, leads sin actividad, conversión, seguimiento del equipo de ventas
- Soporte: atención prospectos y estudiantes, tiempos de respuesta, escalamientos
- Marketing: Meta Ads, TikTok, contenido, CPL, CTR, ROAS, calendario editorial
- Research: benchmarking, competidores, tendencias mercado trabajo remoto
- Reportes: KPIs operativos, métricas clave, alertas de caída

CAPACIDADES DE NAVEGACIÓN WEB
Tienes acceso completo a internet vía herramientas web_*:
- web_search: busca en internet en tiempo real (DuckDuckGo)
- web_navigate: navega a cualquier URL y lee su contenido
- web_read_page: lee páginas completas con paginación
- web_screenshot: captura screenshots de páginas
- web_click / web_fill: interactúa con formularios y elementos
- web_get_links: extrae links de una página
Úsalas proactivamente cuando necesites información externa, verificar datos, investigar o comparar.

PROTOCOLO DE RESPUESTA
Tareas complejas o decisiones:
📍 CONTEXTO   → Qué pasa y por qué importa
🔍 ANÁLISIS   → Datos, patrones, causa raíz
⚙️ OPCIONES   → 2-3 alternativas con pros/contras
✅ RECOMIENDA → Opción preferida + criterio
🔜 SIGUIENTE  → Acción + responsable + tiempo

Consultas simples: responde directo, sin la estructura.

REGLAS
- No inventar información. No prometer resultados.
- Proponer antes de ejecutar en decisiones irreversibles.
- Alertar si algo no cuadra, aunque incomode.
- Nunca ignorar una alerta por no incomodar.
- Si la pregunta toca múltiples áreas, intégralas — no derives.`
  },
  'remi-crm': {
    name: 'Remi-CRM', emoji: '📋',
    model: 'claude-haiku-4-5-20251001',
    systemPrompt: 'Eres Remi-CRM, subagente especializado en GoHighLevel (GHL) de Tu Academia. Gestionas contactos, pipelines, oportunidades y conversaciones. Directo, eficiente y preciso. Buscas el contacto antes de crearlo. Verificas etapa actual antes de mover oportunidades. Lees conversación reciente antes de enviar mensajes. Español neutro, frases cortas.'
  },
  'remi-ventas': {
    name: 'Remi-Ventas', emoji: '💰',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Eres Remi-Ventas, subagente especializado en el pipeline comercial de Tu Academia. Monitoreas leads, analizas show rates, identificas oportunidades sin actividad y apoyas el proceso de ventas. Analítico, propositivo, orientado a resultados. Propones acciones con responsable y tiempo. Español neutro, frases cortas.'
  },
  'remi-soporte': {
    name: 'Remi-Soporte', emoji: '🎧',
    model: 'claude-haiku-4-5-20251001',
    systemPrompt: 'Eres Remi-Soporte, subagente especializado en atención al cliente de Tu Academia. Respondes consultas de prospectos y estudiantes. Tono cálido, emojis moderados. Estructura: contexto → respuesta → acción. Sin promesas de empleo ni ingresos garantizados. Escalas si requiere decisión humana.'
  },
  'remi-marketing': {
    name: 'Remi-Marketing', emoji: '📣',
    model: 'claude-sonnet-4-6',
    systemPrompt: 'Eres Remi-Marketing, subagente especializado en marketing digital de Tu Academia. Analizas campañas Meta, gestionas contenido TikTok y redes, mantienes calendario editorial. Métricas clave: CPL, CTR, ROAS, reach. Propones optimizaciones basadas en datos. Español neutro, orientado a resultados.'
  },
  'remi-research': {
    name: 'Remi-Research', emoji: '🔍',
    model: 'claude-sonnet-4-6',
    systemPrompt: `Eres Remi-Research, subagente especializado en investigación y benchmarking de Tu Academia. Investigas competidores, analizas tendencias del mercado de trabajo remoto y provees datos externos. Riguroso con fuentes, distingues confirmados de estimaciones. Nunca inventas información. Español neutro.

CAPACIDADES WEB (ÚSALAS SIEMPRE)
Tienes acceso completo a internet — NUNCA digas que no puedes buscar información.
- web_search: busca cualquier tema en DuckDuckGo en tiempo real
- web_navigate: lee cualquier página web
- web_read_page: lee páginas largas en partes
- web_get_links: navega la estructura de un sitio
- web_screenshot: captura páginas para verificar
Flujo estándar de investigación: web_search → selecciona mejores URLs → web_read_page → sintetiza → reporta con fuentes.`
  },
  'remi-reportes': {
    name: 'Remi-Reportes', emoji: '📊',
    model: 'claude-haiku-4-5-20251001',
    systemPrompt: 'Eres Remi-Reportes, subagente especializado en métricas y reportes de Tu Academia. Generas reportes operativos, calculas KPIs y emites alertas cuando las métricas se salen del rango. Preciso con números, usas formato tabular cuando aplica. Alertas proactivas ante caídas en conversión o baja actividad.'
  }
};

// ─── Herramientas de integración (tool use / agentic loop) ───────────────────
const INTEGRATION_TOOLS = [
  {
    name: 'save_credential',
    description: 'Guarda una credencial o API key para un servicio de integración del usuario. Úsalo cuando el usuario te proporcione una API key, token u otro dato de autenticación.',
    input_schema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          enum: ['anthropic', 'google', 'notion', 'slack', 'whatsapp'],
          description: 'Nombre del servicio a guardar'
        },
        data: {
          type: 'object',
          description: 'Datos a guardar según el servicio:\n- anthropic: { api_key: "sk-ant-..." }\n- slack: { bot_token: "xoxb-...", team_name: "..." }\n- notion: { access_token: "secret_...", workspace_name: "..." }\n- google: { access_token: "...", refresh_token: "..." }\n- whatsapp: { phone: "+57..." }'
        }
      },
      required: ['service', 'data']
    }
  },
  {
    name: 'get_integration_status',
    description: 'Obtiene el estado actual de todas las integraciones configuradas del usuario.',
    input_schema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'get_oauth_url',
    description: 'Genera la URL de autorización OAuth para que el usuario conecte Google, Notion o Slack. Devuelve una URL clickeable que el usuario debe abrir en su navegador.',
    input_schema: {
      type: 'object',
      properties: {
        service: {
          type: 'string',
          enum: ['google', 'notion', 'slack'],
          description: 'Servicio OAuth a conectar'
        }
      },
      required: ['service']
    }
  }
];

const INTEGRATION_GUIDE = `
HERRAMIENTAS DE INTEGRACIÓN DISPONIBLES
- save_credential: guarda credenciales para cualquier servicio (anthropic, slack, notion, google, whatsapp)
- get_integration_status: consulta qué integraciones tiene activas el usuario
- get_oauth_url: genera URL OAuth para Google, Notion o Slack (alternativa al token manual)

CÓMO INTEGRAR CADA SERVICIO
- Anthropic: pedir api_key (sk-ant-...)
- Slack: pedir bot_token (xoxb-...) y opcionalmente team_name. O usar get_oauth_url.
- Notion: pedir access_token (secret_...) y opcionalmente workspace_name. O usar get_oauth_url.
- Google: preferir get_oauth_url (gestiona refresh token automático). Token manual solo si el usuario insiste.
- WhatsApp: pedir número de teléfono en formato internacional.

Cuando el usuario proporcione un token o key → guárdalo inmediatamente con save_credential. No preguntes confirmación extra.
`;

async function executeTool(toolName, input, userId) {
  if (!userId) throw new Error('userId requerido para ejecutar herramientas de integración');

  if (toolName === 'save_credential') {
    const { service, data } = input;
    const allowed = ['anthropic', 'google', 'notion', 'slack', 'whatsapp'];
    if (!allowed.includes(service)) throw new Error(`Servicio desconocido: ${service}`);

    const creds = readCreds(userId);
    creds[service] = {
      ...(creds[service] || {}),
      ...data,
      updatedAt: new Date().toISOString()
    };
    writeCreds(userId, creds);
    return `✅ Credencial de ${service} guardada correctamente para el usuario ${userId}.`;
  }

  if (toolName === 'get_integration_status') {
    const creds = readCreds(userId);
    const services = ['anthropic', 'google', 'notion', 'slack', 'whatsapp'];
    const status = services.map(svc => {
      const c = creds[svc];
      if (!c || Object.keys(c).length === 0) return `${svc}: ❌ No conectado`;
      if (svc === 'google') {
        const expired = c.expires_at && Date.now() > c.expires_at;
        return `google: ✅ ${c.email || 'conectado'}${expired ? ' ⚠️ token expirado' : ''}`;
      }
      if (svc === 'anthropic') return `anthropic: ✅ API key configurada`;
      if (svc === 'notion') return `notion: ✅ ${c.workspace_name || 'conectado'}`;
      if (svc === 'slack') return `slack: ✅ ${c.team_name || 'conectado'}`;
      if (svc === 'whatsapp') return `whatsapp: ✅ ${c.phone || 'configurado'}`;
      return `${svc}: ✅ conectado`;
    });
    return status.join('\n');
  }

  if (toolName === 'get_oauth_url') {
    const { service } = input;
    const allowed = ['google', 'notion', 'slack'];
    if (!allowed.includes(service)) throw new Error(`OAuth no disponible para: ${service}`);
    const base = process.env.PUBLIC_URL || 'http://localhost:3000';
    const url = `${base}/api/oauth/${service}/start?userId=${encodeURIComponent(userId)}&page=user`;
    return `URL de autorización para ${service}:\n${url}\n\nEl usuario debe abrir este enlace en su navegador para completar la autenticación.`;
  }

  // ─── Tools MCP (GHL, WhatsApp, Meta) ─────────────────────────────────────
  return await executeAgentTool(toolName, input);
}

// authDesktop = alias del middleware compartido (soporta DESKTOP_API_TOKEN + sesiones web)
const authDesktop = requireToken;

// ─── GET /api/desktop/status ──────────────────────────────────────────────────
router.get('/status', authDesktop, (req, res) => {
  res.json({
    ok: true,
    server: 'Remi Desktop API',
    version: '1.0.0',
    agents: Object.keys(AGENTS).length,
    timestamp: new Date().toISOString()
  });
});

// ─── GET /api/desktop/agents ──────────────────────────────────────────────────
router.get('/agents', authDesktop, (req, res) => {
  const list = Object.entries(AGENTS).map(([id, a]) => ({
    id,
    name: a.name,
    emoji: a.emoji,
    model: a.model,
    active: true
  }));
  res.json({ ok: true, agents: list });
});

// ─── POST /api/desktop/chat (SSE streaming) ───────────────────────────────────
router.post('/chat', authDesktop, async (req, res) => {
  const { messages, agentId, userId } = req.body;

  if (!messages || !agentId) {
    return res.status(400).json({ error: 'messages y agentId son requeridos' });
  }

  const agent = AGENTS[agentId];
  if (!agent) {
    return res.status(404).json({ error: `Agente '${agentId}' no encontrado` });
  }

  // ─── Resolver API key según proveedor activo ─────────────────────────────────
  const actualUserId = req.user?.id || (userId && userId !== 'web-user' ? userId : null);
  let anthropicKey = null;

  if (USE_OPENROUTER) {
    // OpenRouter: usa la key del servidor, no del usuario
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({ error: 'OPENROUTER_API_KEY no configurado en el servidor' });
    }
  } else {
    anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (actualUserId) {
      try {
        const credsFile = path.join(MEMORY_DIR, `creds_${actualUserId}.json`);
        if (fs.existsSync(credsFile)) {
          const userCreds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
          if (userCreds.anthropic?.api_key) anthropicKey = userCreds.anthropic.api_key;
        }
      } catch {}
    }
    if (!anthropicKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurado en el servidor' });
    }
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // ─── Crear cliente según proveedor ───────────────────────────────────────────
    const client = USE_OPENROUTER
      ? new OpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey: process.env.OPENROUTER_API_KEY,
          defaultHeaders: {
            'HTTP-Referer': process.env.PUBLIC_URL || 'http://localhost:3000',
            'X-Title': 'Remi'
          }
        })
      : new Anthropic({ apiKey: anthropicKey });

    // ─── Fecha y hora actual (Venezuela UTC-4) — Remi siempre sabe qué día/hora es ──
    const nowVET = new Date().toLocaleString('es-VE', {
      timeZone: 'America/Caracas',
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });

    // ─── Base: CLAUDE.md (identidad, protocolos, tabla sub-agentes, reglas) ─────
    let systemPrompt = `FECHA Y HORA ACTUAL (UTC-4 Venezuela): ${nowVET}\n\n`;
    const claudeMdPath = path.join(__dirname_desktop, '../../CLAUDE.md');
    if (fs.existsSync(claudeMdPath)) {
      systemPrompt += fs.readFileSync(claudeMdPath, 'utf8') + '\n\n---\n';
    }
    systemPrompt += agent.systemPrompt;

    // ─── Contexto especializado del sub-agente (FAQs, flujos, métricas, etc.) ──
    const ctxPath = path.join(__dirname_desktop, '../../context', `${agentId}.md`);
    if (fs.existsSync(ctxPath)) {
      systemPrompt += `\n\n---\nCONTEXTO ESPECIALIZADO:\n${fs.readFileSync(ctxPath, 'utf8')}`;
    }

    // ─── Contexto adicional según agente (archivos extra de context/) ─────────
    const EXTRA_CONTEXT = {
      'remi-crm':  ['remi-plataformas.md', 'remi-plataformas-kb.md'],
      'remi-main': ['remi-plataformas.md', 'remi-ventas.md', 'remi-soporte.md'],
    };
    const extras = EXTRA_CONTEXT[agentId] || [];
    for (const filename of extras) {
      const extraPath = path.join(__dirname_desktop, '../../context', filename);
      if (fs.existsSync(extraPath)) {
        systemPrompt += `\n\n---\n${fs.readFileSync(extraPath, 'utf8')}`;
      }
    }

    // ─── Skill Obsidian-Markdown (sintaxis Obsidian para escritura en vault) ─────
    const obsSkillPath = path.join(__dirname_desktop, '../../vault/skills/obsidian-markdown/SKILL.md');
    if (fs.existsSync(obsSkillPath)) {
      systemPrompt += `\n\n---\nSKILL OBSIDIAN:\n${fs.readFileSync(obsSkillPath, 'utf8')}`;
    }

    // Inyectar perfil y memoria del usuario si existe vault/{vaultFolder}/perfil.md
    const vaultFolder = req.user?.vaultFolder || (userId && userId !== 'web-user' ? `usuarios/${userId}` : null);
    if (vaultFolder) {
      const perfilMd  = readVaultFile(`${vaultFolder}/perfil.md`);
      const memoriaMd = readVaultFile(`${vaultFolder}/memoria.md`);
      const parts = [];
      if (perfilMd)  parts.push(perfilMd);
      if (memoriaMd) parts.push(memoriaMd);
      if (parts.length) {
        systemPrompt += `\n\n---\nCONTEXTO DEL USUARIO (de su vault Obsidian):\n${parts.join('\n\n---\n')}`;
      }
    }

    // ─── Inyectar integraciones conectadas del usuario ────────────────────────
    if (actualUserId) {
      try {
        const credsFile = path.join(MEMORY_DIR, `creds_${actualUserId}.json`);
        if (fs.existsSync(credsFile)) {
          const userCreds = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
          const connected = Object.entries(userCreds)
            .filter(([k, v]) => v && k !== 'anthropic')
            .map(([k, v]) => {
              if (k === 'google')    return `Google (${v.email || 'conectado'})`;
              if (k === 'notion')    return `Notion (${v.workspace_name || 'conectado'})`;
              if (k === 'slack')     return `Slack (${v.team_name || 'conectado'})`;
              if (k === 'whatsapp')  return `WhatsApp (${v.phone || 'conectado'})`;
              return k;
            });
          if (connected.length > 0) {
            systemPrompt += `\n\nINTEGRACIONES CONECTADAS DEL USUARIO:\n${connected.map(s => `- ${s}`).join('\n')}`;
          }
        }
      } catch {}
    }

    // Inyectar guía de integraciones para todos los agentes
    if (actualUserId) {
      systemPrompt += INTEGRATION_GUIDE;
    }

    // ─── Agentic loop con tool use ────────────────────────────────────────────
    let loopMessages = [...messages];
    let totalChars = 0;
    const MAX_ITERATIONS = 6;
    const allTools = actualUserId ? [...INTEGRATION_TOOLS, ...getToolsForAgent(agentId)] : [];

    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {

      if (USE_OPENROUTER) {
        // ── OpenRouter (OpenAI-compatible) ──────────────────────────────────────
        const openaiTools = allTools.length ? toOpenAITools(allTools) : undefined;
        const openaiMessages = [{ role: 'system', content: systemPrompt }, ...loopMessages];

        const stream = await client.chat.completions.create({
          model: toORModel(agent.model),
          max_tokens: 2048,
          messages: openaiMessages,
          tools: openaiTools,
          tool_choice: openaiTools ? 'auto' : undefined,
          stream: true
        });

        let textContent = '';
        const tcMap = {}; // index → { id, name, arguments }

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            textContent += delta.content;
            totalChars += delta.content.length;
            sendEvent('chunk', { text: delta.content });
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!tcMap[idx]) tcMap[idx] = { id: '', name: '', arguments: '' };
              if (tc.id) tcMap[idx].id = tc.id;
              if (tc.function?.name) {
                tcMap[idx].name = tc.function.name;
                sendEvent('tool_use', { tool: tc.function.name });
              }
              if (tc.function?.arguments) tcMap[idx].arguments += tc.function.arguments;
            }
          }
        }

        const toolCalls = Object.values(tcMap).filter(t => t.name);
        if (!toolCalls.length) break;

        // Añadir turno del asistente con tool_calls
        loopMessages.push({
          role: 'assistant',
          content: textContent || null,
          tool_calls: toolCalls.map(tc => ({
            id: tc.id, type: 'function',
            function: { name: tc.name, arguments: tc.arguments }
          }))
        });

        // Ejecutar tools y añadir resultados
        for (const tc of toolCalls) {
          let input;
          try { input = JSON.parse(tc.arguments || '{}'); } catch { input = {}; }
          let result;
          try {
            result = await executeTool(tc.name, input, actualUserId);
            console.log(`🔧 tool:${tc.name} ok | user:${actualUserId}`);
          } catch (err) {
            result = `Error: ${err.message}`;
            console.error(`🔧 tool:${tc.name} error: ${err.message}`);
          }
          loopMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
          });
        }

      } else {
        // ── Anthropic (formato nativo) ──────────────────────────────────────────
        const stream = client.messages.stream({
          model: agent.model,
          max_tokens: 2048,
          system: systemPrompt,
          tools: allTools.length ? allTools : undefined,
          messages: loopMessages
        });

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            totalChars += event.delta.text.length;
            sendEvent('chunk', { text: event.delta.text });
          } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            sendEvent('tool_use', { tool: event.content_block.name });
          }
        }

        const finalMsg = await stream.finalMessage();
        if (finalMsg.stop_reason !== 'tool_use') break;

        const toolUseBlocks = finalMsg.content.filter(b => b.type === 'tool_use');
        if (!toolUseBlocks.length) break;

        loopMessages.push({ role: 'assistant', content: finalMsg.content });

        const toolResults = [];
        for (const toolCall of toolUseBlocks) {
          try {
            const result = await executeTool(toolCall.name, toolCall.input, actualUserId);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            });
            console.log(`🔧 tool:${toolCall.name} ok | user:${actualUserId}`);
          } catch (err) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: `Error: ${err.message}`,
              is_error: true
            });
            console.error(`🔧 tool:${toolCall.name} error: ${err.message}`);
          }
        }

        loopMessages.push({ role: 'user', content: toolResults });
      }
    }

    sendEvent('done', { chars: totalChars, agent: agentId, userId: userId || 'unknown' });
    console.log(`✅ desktop/chat: ${agentId} | user:${userId || '?'} | ${totalChars} chars`);

  } catch (err) {
    console.error(`❌ desktop/chat error: ${err.message}`);
    sendEvent('error', { error: err.message });
  } finally {
    res.end();
  }
});

// ─── POST /api/desktop/chat/simple (sin streaming, para tests) ───────────────
router.post('/chat/simple', authDesktop, async (req, res) => {
  const { messages, agentId, userId } = req.body;
  const agent = AGENTS[agentId];
  if (!agent) return res.status(404).json({ error: `Agente '${agentId}' no encontrado` });

  try {
    let text = '';
    if (USE_OPENROUTER) {
      const orClient = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: process.env.OPENROUTER_API_KEY,
        defaultHeaders: { 'X-Title': 'Remi' }
      });
      const response = await orClient.chat.completions.create({
        model: toORModel(agent.model),
        max_tokens: 2048,
        messages: [{ role: 'system', content: agent.systemPrompt }, ...messages]
      });
      text = response.choices[0]?.message?.content || '';
    } else {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await client.messages.create({
        model: agent.model,
        max_tokens: 2048,
        system: agent.systemPrompt,
        messages
      });
      text = response.content[0]?.text || '';
    }
    console.log(`✅ desktop/chat/simple: ${agentId} | user:${userId || '?'} | ${text.length} chars`);
    res.json({ ok: true, text, agent: agentId });
  } catch (err) {
    console.error(`❌ desktop/chat/simple error: ${err.message}`);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
