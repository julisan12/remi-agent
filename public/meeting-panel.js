// src/meeting-panel.js — Controlador de voz integrado en el chat
// Voice note: MediaRecorder (click=grabar, click=enviar)
// Reunión: WebSocket + Deepgram bidireccional
// Llamada: WebSocket en modo call (Remi responde a todo)

window.ChatVoice = (() => {
  let meetingActive  = false;
  let callActive     = false;
  let voiceRecording = false;
  let mediaRecorder  = null;
  let audioChunks    = [];
  let interventions  = 0;
  let serverCfg      = null;

  // ── Config ───────────────────────────────────────────────────────────────
  async function getServerCfg() {
    if (!serverCfg) serverCfg = await window.remi.config.read('server');
    return serverCfg;
  }

  // ════════════════════════════════════════════════════════════════════════
  // SEND / MIC BUTTON
  // ════════════════════════════════════════════════════════════════════════
  function updateSendBtn() {
    const input = document.getElementById('admin-chat-input');
    const btn   = document.getElementById('admin-send-btn');
    if (!btn) return;
    const hasText = input?.value.trim().length > 0;

    if (hasText) {
      btn.innerHTML = '➤';
      btn.title     = 'Enviar (Enter)';
      btn.className = 'send-btn';
    } else if (voiceRecording) {
      btn.innerHTML = '⏹';
      btn.title     = 'Detener y enviar';
      btn.className = 'send-btn recording';
    } else {
      btn.innerHTML = '🎤';
      btn.title     = 'Nota de voz';
      btn.className = 'send-btn mic-mode';
    }
  }

  function handleSendOrVoice() {
    const input = document.getElementById('admin-chat-input');
    if (input?.value.trim()) {
      if (typeof sendAdminMessage === 'function') sendAdminMessage();
    } else if (voiceRecording) {
      stopVoiceAndSend();
    } else {
      startVoiceNote();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // VOICE NOTE — MediaRecorder
  // Click 1: empieza a grabar  |  Click 2: para y envía
  // ════════════════════════════════════════════════════════════════════════
  async function startVoiceNote() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      mediaRecorder = new MediaRecorder(stream, { mimeType });
      audioChunks   = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks, { type: mimeType });
        await _transcribeAndSend(blob, mimeType);
      };

      mediaRecorder.start(100);
      voiceRecording = true;
      updateSendBtn();

      // Feedback visual en el placeholder
      const input = document.getElementById('admin-chat-input');
      if (input) input.placeholder = '🔴 Grabando... (click ⏹ para enviar)';

    } catch (err) {
      if (typeof showToast === 'function') showToast('No se pudo acceder al micrófono', 'error');
    }
  }

  function stopVoiceAndSend() {
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.stop(); // dispara onstop → _transcribeAndSend
    }
    voiceRecording = false;
    updateSendBtn();
    const input = document.getElementById('admin-chat-input');
    if (input) input.placeholder = '⏳ Transcribiendo...';
  }

  async function _transcribeAndSend(blob, mimeType) {
    const input = document.getElementById('admin-chat-input');
    try {
      const token = window.remi.getToken ? window.remi.getToken() : localStorage.getItem('remi_token');
      if (!token) throw new Error('Sesión no activa');

      const res = await fetch(`/api/desktop/voice/transcribe`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  mimeType,
        },
        body: blob,
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Error de transcripción');

      if (data.transcript?.trim()) {
        if (input) {
          input.value = data.transcript.trim();
          if (typeof autoResizeAdmin === 'function') autoResizeAdmin(input);
        }
        updateSendBtn();
        setTimeout(() => {
          if (typeof sendAdminMessage === 'function') sendAdminMessage();
        }, 200);
      } else {
        if (typeof showToast === 'function') showToast('No se detectó voz', 'warning');
      }

    } catch (err) {
      if (typeof showToast === 'function') showToast(`Voz: ${err.message}`, 'error');
    } finally {
      if (input) input.placeholder = 'Escribe tu mensaje...';
      updateSendBtn();
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // MEETING MODE — WebSocket + Deepgram ambient
  // ════════════════════════════════════════════════════════════════════════
  async function toggleMeeting() {
    if (meetingActive) { stopMeeting(); return; }
    if (callActive)    { stopCall(); }
    await _startVoiceSession('virtual');
  }

  async function startMeeting() { await _startVoiceSession('virtual'); }

  function stopMeeting() {
    MeetingAudio.disconnect();
    meetingActive = false;
    interventions = 0;
    _setSessionUI('meeting', false);
    window.remi.logs.add({ level: 'info', agent: 'meeting', msg: 'Reunión detenida' });
  }

  // ════════════════════════════════════════════════════════════════════════
  // CALL MODE — WebSocket en modo llamada directa
  // ════════════════════════════════════════════════════════════════════════
  async function toggleCall() {
    if (callActive)   { stopCall(); return; }
    if (meetingActive) { stopMeeting(); }
    await _startVoiceSession('call');
  }

  function stopCall() {
    MeetingAudio.disconnect();
    callActive    = false;
    interventions = 0;
    _setSessionUI('call', false);
    window.remi.logs.add({ level: 'info', agent: 'meeting', msg: 'Llamada terminada' });
  }

  // ── Sesión compartida (reunión o llamada) ────────────────────────────────
  async function _startVoiceSession(mode) {
    // En versión web: usar el origen actual y el token de sesión
    const serverUrl = window.location.origin;
    const token     = window.remi.getToken ? window.remi.getToken() : localStorage.getItem('remi_token');
    if (!token) {
      if (typeof showToast === 'function') showToast('Sesión no activa — vuelve a iniciar sesión', 'error');
      return;
    }

    interventions = 0;
    const isCall = mode === 'call';

    MeetingAudio.on('onReady', () => {
      if (isCall) { callActive = true;    _setSessionUI('call', true);    }
      else        { meetingActive = true; _setSessionUI('meeting', true); }
      window.remi.logs.add({ level: 'info', agent: 'meeting', msg: `${isCall ? 'Llamada' : 'Reunión'} iniciada` });
    });

    MeetingAudio.on('onPartial', (text) => _updateTranscript(text, false));
    MeetingAudio.on('onFinal',   (text) => _updateTranscript(text, true));

    MeetingAudio.on('onRemiStart', () => {
      const dot = document.getElementById('meeting-dot');
      if (dot) dot.className = 'meeting-dot speaking';
    });

    MeetingAudio.on('onRemiDone', (data) => {
      const dot = document.getElementById('meeting-dot');
      if (dot) dot.className = 'meeting-dot';
      interventions++;
      _updateInterventionCount();
    });

    MeetingAudio.on('onError', (err) => {
      // Ignorar aviso de VB-Cable si hay audífonos — el audio sale igual
      if (!err.includes('VB-Cable')) {
        if (typeof showToast === 'function') showToast(err, 'warning');
      }
    });

    // En modo llamada: presencial (sale por audífonos, sin VB-Cable)
    await MeetingAudio.connect(serverUrl, token, isCall ? 'presencial' : 'virtual');
  }

  // ── Helpers UI ───────────────────────────────────────────────────────────
  function _setSessionUI(type, active) {
    const bar     = document.getElementById('meeting-status-bar');
    const meetBtn = document.getElementById('meeting-btn');
    const callBtn = document.getElementById('call-btn');
    const cnt     = document.getElementById('meeting-intervention-count');
    const dot     = document.getElementById('meeting-dot');

    if (bar) bar.classList.toggle('hidden', !active);
    if (cnt) { cnt.classList.add('hidden'); cnt.textContent = ''; }

    if (type === 'call') {
      if (callBtn)  callBtn.classList.toggle('active-call', active);
      if (meetBtn)  meetBtn.classList.remove('active-meeting');
      if (dot && active) dot.style.background = '#4CAF50';
    } else {
      if (meetBtn)  meetBtn.classList.toggle('active-meeting', active);
      if (callBtn)  callBtn.classList.remove('active-call');
      if (dot && active) dot.style.background = '#4fc3f7';
    }

    if (!active) {
      const t = document.getElementById('meeting-live-transcript');
      if (t) t.innerHTML = 'Escuchando...';
    }
  }

  function _updateTranscript(text, isFinal) {
    const el = document.getElementById('meeting-live-transcript');
    if (!el) return;
    const prev = el.querySelector('.partial');
    if (prev) prev.remove();
    const span = document.createElement('span');
    span.className   = isFinal ? 'final' : 'partial';
    span.textContent = text + ' ';
    el.appendChild(span);
  }

  function _updateInterventionCount() {
    const el = document.getElementById('meeting-intervention-count');
    if (!el) return;
    el.classList.remove('hidden');
    el.textContent = `${interventions} intervención${interventions !== 1 ? 'es' : ''}`;
  }

  return { updateSendBtn, handleSendOrVoice, toggleMeeting, startMeeting, stopMeeting, toggleCall, stopCall };
})();
