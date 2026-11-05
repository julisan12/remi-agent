// src/meeting/audio-output.js — Síntesis de voz streaming via ElevenLabs
// Recibe texto, lo convierte a audio en streaming y envía chunks al cliente

const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // Adam (male)

/**
 * Convierte texto a audio via ElevenLabs streaming y envía chunks por WebSocket.
 * Empieza a reproducir desde el primer chunk sin esperar que termine.
 * @param {WebSocket} ws  - Conexión del cliente
 * @param {string}    text - Texto a sintetizar
 * @param {string}    mode - 'virtual' | 'presencial' (el cliente rutea el audio)
 */
export async function streamAudioToClient(ws, text, mode = 'virtual') {
  // ElevenLabs deshabilitado — el cliente usa speechSynthesis (browser TTS)
  // Re-habilitar cuando se tenga plan pago de ElevenLabs
  return;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5', // menor latencia disponible
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.8,
          style: 0.0,
          use_speaker_boost: true,
        },
        output_format: 'mp3_44100_128',
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs ${response.status}: ${err}`);
  }

  const reader = response.body.getReader();
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.length;

    if (ws.readyState === ws.OPEN) {
      // Enviar chunk inmediatamente — el cliente empieza a reproducir sin esperar
      ws.send(JSON.stringify({
        type: 'audio_chunk',
        mode,           // cliente usa esto para rutear a VB-Cable o altavoz
        data: Buffer.from(value).toString('base64'),
        format: 'mp3',
      }));
    }
  }

  console.log(`🔊 Audio enviado: ${text.length} chars → ${totalBytes} bytes`);
}
