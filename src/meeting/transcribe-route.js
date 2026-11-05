// src/meeting/transcribe-route.js — POST /api/desktop/voice/transcribe
// Recibe audio binario del desktop, transcribe con Deepgram REST, devuelve texto

import { Router } from 'express';
import { requireToken } from '../middleware/auth.js';

const router = Router();

router.post('/voice/transcribe', requireToken, async (req, res) => {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: 'DEEPGRAM_API_KEY no configurado' });

  try {
    // Leer el cuerpo como buffer raw
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);

    if (!audioBuffer.length) {
      return res.status(400).json({ ok: false, error: 'Audio vacío' });
    }

    const contentType = req.headers['content-type'] || 'audio/webm';

    const dgRes = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&language=es&punctuate=true&smart_format=true',
      {
        method:  'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type':  contentType,
        },
        body: audioBuffer,
      }
    );

    if (!dgRes.ok) {
      const err = await dgRes.text();
      console.error('❌ Deepgram transcribe error:', err);
      return res.status(500).json({ ok: false, error: `Deepgram: ${dgRes.status}` });
    }

    const data       = await dgRes.json();
    const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    const confidence = data.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0;

    console.log(`🎤 Transcripción: "${transcript}" (conf: ${confidence.toFixed(2)})`);
    res.json({ ok: true, transcript, confidence });

  } catch (err) {
    console.error('❌ transcribe-route error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
