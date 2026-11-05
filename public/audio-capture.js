// src/audio-capture.js — Captura de micrófono + WebSocket meeting
// Corre en el renderer (browser context) — no requiere IPC

window.MeetingAudio = (() => {
  let ws = null;
  let audioContext = null;
  let processor = null;
  let stream = null;
  let outputDevice = null; // device ID para VB-Cable
  let mode = 'virtual';
  let audioQueue = []; // chunks MP3 base64 pendientes (ElevenLabs, deshabilitado)
  let isPlaying = false;
  let _ttsVoice = null; // voz pre-seleccionada para speechSynthesis

  // ── Callbacks externos ───────────────────────────────────────────────────
  const handlers = {
    onPartial:   () => {},
    onFinal:     () => {},
    onRemiStart: () => {},
    onRemiDone:  () => {},
    onError:     () => {},
    onReady:     () => {},
  };

  function on(event, fn) { handlers[event] = fn; }

  // ── Browser TTS ───────────────────────────────────────────────────────────
  // Chrome carga voces de forma asíncrona — hay que esperar el evento
  function _initTTSVoice() {
    return new Promise((resolve) => {
      const pick = () => {
        const voices = window.speechSynthesis.getVoices();
        // Preferir: voz local española > online española > cualquier voz
        _ttsVoice =
          voices.find(v => v.lang.startsWith('es') && v.localService) ||
          voices.find(v => v.lang.startsWith('es')) ||
          voices[0] || null;
        resolve(_ttsVoice);
      };

      if (window.speechSynthesis.getVoices().length > 0) {
        pick();
      } else {
        window.speechSynthesis.addEventListener('voiceschanged', pick, { once: true });
        // Timeout de seguridad: 2s máximo esperando voces
        setTimeout(pick, 2000);
      }
    });
  }

  function _speak(text) {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    if (_ttsVoice) utt.voice = _ttsVoice;
    utt.lang = 'es';
    utt.rate = 1.05;
    utt.pitch = 1.0;
    window.speechSynthesis.speak(utt);
  }

  // ── Detectar VB-Cable ────────────────────────────────────────────────────
  async function findVBCable() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cable = devices.find(d =>
        d.kind === 'audiooutput' &&
        d.label.toLowerCase().includes('cable input')
      );
      return cable?.deviceId || null;
    } catch { return null; }
  }

  // ── Conectar WebSocket + micrófono ───────────────────────────────────────
  async function connect(serverUrl, token, meetingMode = 'virtual') {
    mode = meetingMode;
    outputDevice = await findVBCable();
    await _initTTSVoice(); // pre-cargar voz antes de abrir WebSocket

    if (mode === 'virtual' && !outputDevice) {
      handlers.onError('VB-Cable no detectado — el audio saldrá por el altavoz default');
    }

    // Convertir URL HTTP→WS
    const wsUrl = serverUrl
      .replace(/^https:/, 'wss:')
      .replace(/^http:/, 'ws:')
      .replace(/\/$/, '');

    ws = new WebSocket(`${wsUrl}/meeting/ws?token=${token}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = async () => {
      await startMicrophone();
      handlers.onReady();
    };

    ws.onmessage = (evt) => handleMessage(JSON.parse(evt.data));

    ws.onerror = (err) => handlers.onError('Error de conexión con el servidor');

    ws.onclose = () => {
      stopMicrophone();
    };
  }

  // ── Manejar mensajes del servidor ────────────────────────────────────────
  function handleMessage(msg) {
    switch (msg.type) {
      case 'partial':
        handlers.onPartial(msg.text);
        break;
      case 'final':
        handlers.onFinal(msg.text);
        break;
      case 'remi_speaking':
        // Cancelar TTS en curso si Remi va a hablar de nuevo
        window.speechSynthesis?.cancel();
        handlers.onRemiStart(msg.label);
        break;
      case 'remi_done':
        // Browser TTS (ElevenLabs deshabilitado — free tier bloqueado por Railway IPs)
        if (msg.speak) _speak(msg.speak);
        handlers.onRemiDone(msg);
        break;
      case 'audio_chunk':
        // ElevenLabs deshabilitado; si se re-habilita, descomentar:
        // queueAudio(msg.data, msg.mode);
        break;
      case 'error':
        handlers.onError(msg.error);
        break;
    }
  }

  // ── Captura de micrófono en PCM16 para Deepgram ──────────────────────────
  async function startMicrophone() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        // sampleRate NO va aquí — no es constraint estándar, falla en Chrome/Firefox
        // El AudioContext maneja el resampling a 16kHz
      }
    });

    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);

    // ScriptProcessorNode para obtener PCM float32 y convertir a int16
    processor = audioContext.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = float32ToInt16(float32);
      ws.send(int16.buffer);
    };

    source.connect(processor);
    processor.connect(audioContext.destination);
  }

  function stopMicrophone() {
    processor?.disconnect();
    stream?.getTracks().forEach(t => t.stop());
    audioContext?.close();
    processor = null;
    stream = null;
    audioContext = null;
  }

  function float32ToInt16(float32) {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  // ── Reproducción de audio MP3 (chunks de ElevenLabs) ────────────────────
  function queueAudio(base64Data, chunkMode) {
    audioQueue.push({ base64Data, chunkMode });
    if (!isPlaying) playNextChunk();
  }

  async function playNextChunk() {
    if (audioQueue.length === 0) { isPlaying = false; return; }
    isPlaying = true;

    const { base64Data, chunkMode } = audioQueue.shift();

    try {
      // Decodificar base64 → ArrayBuffer
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      const audio = new Audio(url);

      // Rutear a VB-Cable si modo virtual y dispositivo disponible
      if (chunkMode === 'virtual' && outputDevice) {
        await audio.setSinkId(outputDevice);
      }

      audio.onended = () => {
        URL.revokeObjectURL(url);
        playNextChunk();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        playNextChunk();
      };

      await audio.play();
    } catch (err) {
      console.error('Audio playback error:', err);
      playNextChunk();
    }
  }

  // ── Control ──────────────────────────────────────────────────────────────
  function setMode(newMode) {
    mode = newMode;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'mode', mode: newMode }));
    }
  }

  function disconnect() {
    window.speechSynthesis?.cancel();
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stop' }));
      ws.close();
    }
    stopMicrophone();
    audioQueue = [];
    isPlaying = false;
  }

  return { connect, disconnect, setMode, on };
})();
