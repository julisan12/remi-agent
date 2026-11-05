// src/lib/heartbeat.js
// Singleton en memoria para coordinar primary (local) vs fallback (Railway)
// No requiere archivo — estado vive en el proceso Node mientras esté activo

const state = { sendflow: null };

export function recordHeartbeat(key) {
  state[key] = new Date().toISOString();
}

export function isLocalActive(key, thresholdMinutes = 15) {
  const last = state[key];
  if (!last) return false;
  return (Date.now() - new Date(last).getTime()) < thresholdMinutes * 60 * 1000;
}

export function getHeartbeatInfo(key) {
  const last = state[key];
  const ageMs = last ? Date.now() - new Date(last).getTime() : null;
  return {
    last_heartbeat: last,
    age_minutes: ageMs ? Math.round(ageMs / 60000 * 10) / 10 : null,
    local_active: isLocalActive(key),
  };
}
