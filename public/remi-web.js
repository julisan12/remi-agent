// remi-web.js — Shim de window.remi para la versión web
// Reemplaza el IPC de Electron con llamadas fetch al servidor

(function () {
  const TOKEN_KEY = 'remi_token';
  const USER_KEY = 'remi_user';

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }

  function saveSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function doLogout() {
    fetch('/api/web/logout', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken() }
    }).finally(() => {
      clearSession();
      window.location.href = '/';
    });
  }

  async function apiGet(path) {
    const res = await fetch(path, {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    });
    if (res.status === 401) { doLogout(); return {}; }
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken()
      },
      body: JSON.stringify(body)
    });
    if (res.status === 401) { doLogout(); return { ok: false, error: 'Sesión expirada' }; }
    return res.json();
  }

  // ─── Chat streaming ─────────────────────────────────────────────────────────
  let chatCbs = { chunk: null, done: null, error: null };
  let chatAbort = null;

  const chatApi = {
    // Acepta tanto send({messages,agentId,userId}) como send(messages, agentId, apiKey)
    send: async function (messagesOrObj, agentIdArg) {
      let messages, agentId, userId;
      if (messagesOrObj && !Array.isArray(messagesOrObj) && typeof messagesOrObj === 'object') {
        messages = messagesOrObj.messages;
        agentId = messagesOrObj.agentId;
        userId = messagesOrObj.userId;
      } else {
        messages = messagesOrObj;
        agentId = agentIdArg;
        userId = null;
      }

      chatAbort = new AbortController();

      try {
        const response = await fetch('/api/desktop/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + getToken()
          },
          body: JSON.stringify({ messages, agentId, userId: userId || 'web-user' }),
          signal: chatAbort.signal
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Error del servidor' }));
          chatCbs.error?.({ error: err.error || 'Error del servidor' });
          return { ok: false };
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            try {
              const parsed = JSON.parse(raw);
              if (parsed.text !== undefined) chatCbs.chunk?.({ text: parsed.text });
              else if (parsed.error) chatCbs.error?.({ error: parsed.error });
            } catch {}
          }
        }
        chatCbs.done?.();
        return { ok: true };
      } catch (err) {
        if (err.name !== 'AbortError') chatCbs.error?.({ error: err.message });
        return { ok: false };
      }
    },
    onChunk: (cb) => { chatCbs.chunk = cb; },
    onDone: (cb) => { chatCbs.done = cb; },
    onError: (cb) => { chatCbs.error = cb; },
    removeListeners: () => {
      chatCbs = { chunk: null, done: null, error: null };
      chatAbort?.abort();
      chatAbort = null;
    }
  };

  // ─── API window.remi ────────────────────────────────────────────────────────
  window.remi = {
    auth: {
      login: async (payload) => {
        const data = await apiPost('/api/web/login', payload);
        if (data.ok) {
          saveSession(data.token, data.user);
          // Navegar al panel correspondiente
          window.location.href = data.user.role === 'admin' ? '/admin.html' : '/user.html';
        }
        return data;
      },
      logout: () => { doLogout(); return Promise.resolve({ ok: true }); },
      getUsers: () => fetch('/api/web/users').then(r => r.json())
    },

    config: {
      read: (name) => apiGet('/api/config/' + name),
      write: (name, data) => apiPost('/api/config/' + name, data)
    },

    logs: {
      get: (limit) => apiGet('/api/logs?limit=' + (limit || 100)),
      add: (entry) => apiPost('/api/logs', entry)
    },

    chat: chatApi,

    admin: {
      changePassword: (payload) => apiPost('/api/admin/change-password', payload)
    },

    users: {
      save: (payload) => apiPost('/api/users/save', payload),
      requestTool: (payload) => apiPost('/api/users/request-tool', payload)
    },

    // Obsidian — vault de markdowns en el servidor
    obsidian: {
      listFiles: (_vaultPath) => apiGet('/api/vault'),
      readFile:  (_vaultPath, filePath) => apiGet('/api/vault/' + filePath),
      writeFile: (_vaultPath, filePath, content) =>
        apiPost('/api/vault/' + filePath, { content })
    },

    openExternal: (url) => window.open(url, '_blank'),

    // Expone el token de sesión para uso interno (WebSocket, etc.)
    getToken: () => getToken()
  };

  // ─── Auth guard ──────────────────────────────────────────────────────────────
  (function checkAuth() {
    const path = window.location.pathname;
    const isLoginPage = path === '/' || path === '/index.html' || path.endsWith('login.html');
    const hasToken = !!getToken();

    if (!isLoginPage && !hasToken) {
      window.location.href = '/';
      return;
    }

    // Si ya hay token y está en login, redirigir al panel
    if (isLoginPage && hasToken) {
      try {
        const user = JSON.parse(localStorage.getItem(USER_KEY) || '{}');
        if (user.role === 'admin') window.location.href = '/admin.html';
        else if (user.role === 'user') window.location.href = '/user.html';
      } catch {}
    }
  })();
})();
