// src/meeting/websocket-handler.js — WebSocket en /meeting/ws

import { WebSocketServer } from 'ws';
import { createClient } from '@deepgram/sdk';
import { DecisionEngine } from './decision-engine.js';
import { getSession } from '../middleware/auth.js';

const DEEPGRAM_OPTIONS = {
  model:           'nova-2',
  language:        'es',
  punctuate:       true,
  interim_results: true,
  endpointing:     300,
  encoding:        'linear16',
  sample_rate:     16000,
};

/**
 * Registra el WebSocket de reunión sobre el servidor HTTP existente.
 * @param {import('http').Server} server
 */
export function registerMeetingWS(server) {
  try {
    const wss = new WebSocketServer({ server, path: '/meeting/ws' });

    wss.on('connection', (ws, req) => {
      // ── Autenticación por query param ───────────────────────────────────
      const url   = new URL(req.url, 'ws://localhost');
      const token = url.searchParams.get('token');
      const desktopToken = process.env.DESKTOP_API_TOKEN;
      const isDesktop = desktopToken && token === desktopToken;
      const isWeb     = !isDesktop && !!getSession(token);
      if (!isDesktop && !isWeb) {
        ws.close(1008, 'Unauthorized');
        console.warn('🚫 Meeting WS: token inválido');
        return;
      }

      console.log('🤝 Cliente meeting conectado');
      const engine = new DecisionEngine(ws);
      let deepgramConn  = null;
      let reconnecting  = false;

      // ── Conectar a Deepgram ──────────────────────────────────────────────
      async function connectDeepgram() {
        const apiKey = process.env.DEEPGRAM_API_KEY;
        if (!apiKey) {
          console.error('❌ DEEPGRAM_API_KEY no configurado');
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'error', error: 'DEEPGRAM_API_KEY no configurado' }));
          }
          return;
        }

        try {
          const dg = createClient(apiKey);
          deepgramConn = dg.listen.live(DEEPGRAM_OPTIONS);

          // Usar strings directos — compatibles con todas las versiones del SDK
          deepgramConn.on('open', () => {
            console.log('🎙️  Deepgram conectado');
            reconnecting = false;
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'deepgram_ready' }));
            }
          });

          deepgramConn.on('Results', (data) => {
            const alt        = data.channel?.alternatives?.[0];
            const transcript = alt?.transcript || '';
            if (!transcript) return;

            const isFinal    = data.is_final;
            const confidence = alt?.confidence || 0;

            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({
                type:       isFinal ? 'final' : 'partial',
                text:       transcript,
                confidence,
              }));
            }

            if (isFinal && transcript.trim()) {
              engine.addTranscript(transcript, confidence);
            }
          });

          deepgramConn.on('error', (err) => {
            console.error('❌ Deepgram error:', err?.message || err);
            if (!reconnecting && ws.readyState === ws.OPEN) {
              reconnecting = true;
              setTimeout(connectDeepgram, 2000);
            }
          });

          deepgramConn.on('close', () => {
            console.log('🔌 Deepgram desconectado');
          });

        } catch (err) {
          console.error('❌ Error iniciando Deepgram:', err.message);
          if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ type: 'error', error: `Deepgram: ${err.message}` }));
          }
        }
      }

      connectDeepgram();

      // ── Mensajes del cliente ────────────────────────────────────────────
      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          if (deepgramConn) deepgramConn.send(data);
        } else {
          try {
            const msg = JSON.parse(data.toString());
            switch (msg.type) {
              case 'stop':
                engine.stop();
                try { deepgramConn?.finish(); } catch {}
                break;
              case 'mode':
                engine.setMode(msg.mode);
                break;
              case 'ping':
                ws.send(JSON.stringify({ type: 'pong' }));
                break;
            }
          } catch { /* ignorar mensajes mal formados */ }
        }
      });

      ws.on('close', () => {
        engine.stop();
        try { deepgramConn?.finish(); } catch {}
        console.log('👋 Cliente meeting desconectado');
      });

      ws.on('error', (err) => {
        console.error('❌ Meeting WS cliente error:', err.message);
      });
    });

    wss.on('error', (err) => {
      console.error('❌ Meeting WSS error:', err.message);
    });

    console.log('📡 Meeting WebSocket registrado en /meeting/ws');

  } catch (err) {
    console.error('❌ No se pudo registrar Meeting WebSocket:', err.message);
  }
}
