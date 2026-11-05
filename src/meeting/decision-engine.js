// src/meeting/decision-engine.js — Motor cognitivo en tiempo real
// Buffer circular de 90s + evaluación cada 800ms + 5 reglas de prioridad

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { streamAudioToClient } from './audio-output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Cargar persona de Remi desde archivo — no hardcodeada
let REMI_PERSONA;
try {
  REMI_PERSONA = readFileSync(join(__dirname, '../../voice/remi_persona.txt'), 'utf8');
} catch {
  REMI_PERSONA = 'Eres Remi, agente de inteligencia operativa de Tu Academia. Directo, analítico, honesto.';
  console.warn('⚠️  voice/remi_persona.txt no encontrado — usando persona mínima');
}

const BUFFER_WINDOW_MS  = 90_000;  // 90 segundos de contexto
const EVAL_INTERVAL_MS  = 800;     // evalúa cada 800ms
const SILENCE_MS        = 800;     // silencio para considerar pregunta completa
const VOLUNTEER_MS      = 8_000;   // máximo sin hablar antes de opinar
const INTERRUPT_CONF    = 0.75;    // confianza mínima para interrumpir

// Palabras clave que hacen el tema relevante para Remi
const KEYWORDS = [
  'pipeline', 'leads', 'conversión', 'ventas', 'marketing', 'campaña',
  'estudiantes', 'acceso', 'remotos', 'métricas', 'kpi', 'tasa',
  'show rate', 'workshop', 'certificación', 'ghl', 'meta', 'tiktok',
  'cpl', 'ctr', 'roas', 'asesor', 'asesor', 'asesor', 'asesor', 'asesor',
];

export class DecisionEngine {
  constructor(ws) {
    this.ws     = ws;
    this.buffer = [];           // { text, timestamp, confidence }
    this.isSpeaking      = false;
    this.lastRemiSpoke   = 0;
    this.lastTranscript  = 0;
    this.interventions   = [];  // log de últimas 5
    this.mode            = 'virtual';
    this.stopped         = false;

    this.intervalId = setInterval(() => this.evaluate(), EVAL_INTERVAL_MS);
  }

  // ─── Agrega transcripción final al buffer ────────────────────────────────
  addTranscript(text, confidence = 1) {
    if (this.stopped) return;
    const now = Date.now();
    this.lastTranscript = now;

    // Limpiar entradas viejas
    const cutoff = now - BUFFER_WINDOW_MS;
    this.buffer = this.buffer.filter(e => e.timestamp > cutoff);

    this.buffer.push({ text, timestamp: now, confidence });
  }

  // ─── Bucle de evaluación ─────────────────────────────────────────────────
  async evaluate() {
    if (this.stopped || this.isSpeaking || this.buffer.length === 0) return;

    const now        = Date.now();
    const last       = this.buffer[this.buffer.length - 1];
    const silenceMs  = now - this.lastTranscript;
    const sinceRemi  = now - this.lastRemiSpoke;

    // Contexto reciente (últimos 30s)
    const recent     = this.buffer.filter(e => e.timestamp > now - 30_000);
    const recentText = recent.map(e => e.text).join(' ');

    // ── Modo presencial (llamada directa): responde a cada input ─────────
    if (this.mode === 'presencial') {
      if (this.lastTranscript > this.lastRemiSpoke && silenceMs > SILENCE_MS) {
        await this._respond(recent, 'respondió');
      }
      return;
    }

    // ── Modo virtual (reunión): reglas de prioridad ───────────────────────
    let action = 'ignore';
    let label  = '';

    // 1. Mención directa de "Remi"
    if (/\bremi\b/i.test(last.text)) {
      action = 'respond_immediate';
      label  = 'respondió';
    }
    // 2. Pregunta + silencio > 1.5s
    else if (last.text.trim().endsWith('?') && silenceMs > SILENCE_MS) {
      action = 'respond';
      label  = 'respondió';
    }
    // 3. Afirmación con dato potencialmente incorrecto + confianza alta
    else if (this._isIncorrectAssertion(last.text) && last.confidence > INTERRUPT_CONF) {
      action = 'interrupt';
      label  = 'interrumpió';
    }
    // 4. Remi no ha hablado en 8s y el tema es relevante
    else if (sinceRemi > VOLUNTEER_MS && this._isRelevant(recentText)) {
      action = 'volunteer';
      label  = 'opinó';
    }

    if (action === 'ignore') return;

    await this._respond(recent, label);
  }

  // ─── Llama a Claude y hace streaming a ElevenLabs ────────────────────────
  async _respond(contextBuffer, label) {
    if (this.isSpeaking || this.stopped) return;
    this.isSpeaking = true;

    try {
      this._send('remi_speaking', { label });

      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const contextText = contextBuffer
        .map(e => `[${new Date(e.timestamp).toLocaleTimeString('es-CO')}] ${e.text}`)
        .join('\n');

      const stream = client.messages.stream({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,  // respuestas cortas en reuniones
        system: REMI_PERSONA,
        messages: [{
          role: 'user',
          content:
            `Estás participando en una reunión de equipo de Tu Academia. ` +
            `Intervén como lo haría un colaborador senior: directo, concreto, sin relleno. ` +
            `Últimas intervenciones:\n\n${contextText}\n\n` +
            `Responde en máximo 2-3 oraciones.`,
        }],
      });

      let fullResponse = '';
      let sentenceBuffer = '';

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
          const text = chunk.delta.text;
          fullResponse    += text;
          sentenceBuffer  += text;

          // Enviar a ElevenLabs en cuanto tengamos una oración completa
          if (/[.!?]/.test(sentenceBuffer) && sentenceBuffer.length > 15) {
            await streamAudioToClient(this.ws, sentenceBuffer.trim(), this.mode);
            sentenceBuffer = '';
          }
        }
      }

      // Resto pendiente
      if (sentenceBuffer.trim()) {
        await streamAudioToClient(this.ws, sentenceBuffer.trim(), this.mode);
      }

      // Registrar intervención
      this.lastRemiSpoke = Date.now();
      this.interventions.push({ label, text: fullResponse, timestamp: Date.now() });
      if (this.interventions.length > 5) this.interventions.shift();

      this._send('remi_done', {
        label,
        text: fullResponse,
        interventionCount: this.interventions.length,
        recentInterventions: this.interventions.slice(-5),
        speak: fullResponse,  // fallback browser TTS si ElevenLabs falla
      });

      console.log(`🎙️ Remi ${label}: ${fullResponse.slice(0, 80)}...`);

    } catch (err) {
      console.error('❌ DecisionEngine error:', err.message);
      this._send('error', { error: err.message });
    } finally {
      this.isSpeaking = false;
    }
  }

  // ─── Detecta afirmación con datos numéricos (posiblemente incorrecta) ────
  _isIncorrectAssertion(text) {
    const hasData   = /\d+%|\$\d+|\d+\s*(leads|contactos|estudiantes)/i.test(text);
    const isNotQn   = !text.trim().endsWith('?');
    const hasMetric = /conversión|tasa|pipeline|cpl|ctr|roas/i.test(text);
    return hasData && isNotQn && hasMetric;
  }

  // ─── Verifica si el tema es relevante para Remi ──────────────────────────
  _isRelevant(text) {
    const t = text.toLowerCase();
    return KEYWORDS.some(kw => t.includes(kw));
  }

  // ─── Enviar evento JSON al cliente ───────────────────────────────────────
  _send(type, data = {}) {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify({ type, ...data }));
    }
  }

  setMode(mode) {
    this.mode = mode;
    console.log(`🔄 Modo reunión: ${mode}`);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.intervalId);
    this.buffer = [];
    this.isSpeaking = false;
    console.log('⏹️  DecisionEngine detenido');
  }
}
