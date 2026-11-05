// mcp/ghl/tools/browser.js
// Tool MCP que ejecuta tareas en GHL via browser automation (modo asíncrono)

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, existsSync, writeFileSync, openSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");
const RESULT_FILE = join(ROOT, "memory", "browser_last_result.json");
const LOG_FILE = join(ROOT, "memory", "browser_output.log");

// Lee PYTHON_PATH del .env
function getPythonPath() {
  const envPath = join(ROOT, "config", ".env");
  if (existsSync(envPath)) {
    const env = readFileSync(envPath, "utf-8");
    const match = env.match(/^PYTHON_PATH=(.+)$/m);
    if (match) return match[1].trim();
  }
  return "python";
}

/**
 * Lanza browser_agent.py en background y guarda el resultado en memory/
 */
export async function runBrowserTask({ tarea }) {
  const pythonPath = getPythonPath();
  const scriptPath = join(ROOT, "browser_agent.py");

  if (!existsSync(scriptPath)) {
    throw new Error(`browser_agent.py no encontrado en ${scriptPath}`);
  }

  // Guardar estado "en progreso"
  writeFileSync(RESULT_FILE, JSON.stringify({
    status: "running",
    tarea,
    startedAt: new Date().toISOString(),
    result: null,
  }, null, 2));

  // Abrir archivo de log para capturar output del proceso hijo
  const logFd = openSync(LOG_FILE, "w");

  // Lanzar en background — stdio hacia archivo, no pipe
  const proc = spawn(pythonPath, [scriptPath, tarea], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });

  // Un solo handler de close que lee el log
  proc.on("close", (code) => {
    try {
      const output = existsSync(LOG_FILE)
        ? readFileSync(LOG_FILE, "utf-8")
        : "";

      // Extraer resultado: buscar bloque 'done' del agente con success:True
      const doneMatch = output.match(/'done':\s*\{[^}]*'text':\s*"([\s\S]+?)",\s*'success':\s*(True|False)/);
      const doneText = doneMatch ? doneMatch[1].replace(/\\n/g, "\n").trim() : null;
      const agentSuccess = doneMatch ? doneMatch[2] === "True" : false;

      // Fallback: últimos 3000 chars del log si no hay bloque done
      const result = doneText || output.replace(/\u0000/g, "").slice(-3000).trim();

      // Determinar status: completado si exitó bien O si el agente reportó success
      const status = (code === 0 || agentSuccess) ? "completed" : "failed";

      const previous = existsSync(RESULT_FILE)
        ? JSON.parse(readFileSync(RESULT_FILE, "utf-8"))
        : {};

      writeFileSync(RESULT_FILE, JSON.stringify({
        status,
        tarea,
        startedAt: previous.startedAt || new Date().toISOString(),
        completedAt: new Date().toISOString(),
        result: result || "Sin resultado explícito",
        exitCode: code,
      }, null, 2));
    } catch (err) {
      // Si falla al escribir el resultado, al menos registrar el error
      writeFileSync(RESULT_FILE, JSON.stringify({
        status: "failed",
        tarea,
        completedAt: new Date().toISOString(),
        result: `Error al procesar resultado: ${err.message}`,
        exitCode: code,
      }, null, 2));
    }
  });

  proc.unref();

  return `🚀 Browser agent iniciado en background.

📋 Tarea: ${tarea}

⏳ Esta tarea toma entre 5-12 minutos. Cuando termine, el resultado se guardará automáticamente en memory/browser_last_result.json

Para ver el resultado cuando esté listo usa: ghl_browser_result`;
}

/**
 * Consulta el resultado de la última tarea ejecutada
 */
export async function getBrowserResult() {
  if (!existsSync(RESULT_FILE)) {
    return "No hay ninguna tarea de browser ejecutada aún.";
  }

  const data = JSON.parse(readFileSync(RESULT_FILE, "utf-8"));

  if (data.status === "running") {
    const elapsed = Math.round((Date.now() - new Date(data.startedAt)) / 1000 / 60);
    return `⏳ Tarea en progreso (${elapsed} min transcurridos)\n\n📋 Tarea: ${data.tarea}\n\nVuelve a consultar en unos minutos.`;
  }

  const duration = data.completedAt && data.startedAt
    ? Math.round((new Date(data.completedAt) - new Date(data.startedAt)) / 1000)
    : null;
  const durationStr = duration ? ` | Duración: ${Math.floor(duration/60)}m ${duration%60}s` : "";

  // Extraer solo el texto del bloque 'done' si existe, descartar el resto del JSON
  function extractCleanResult(raw) {
    if (!raw) return "Sin resultado";
    // Buscar texto del done action
    const doneMatch = raw.match(/'done':\s*\{[^}]*'text':\s*"([\s\S]{0,800})"/);
    if (doneMatch) return doneMatch[1].replace(/\\n/g, "\n").trim();
    // Buscar mensaje de error legible
    const errMatch = raw.match(/'message':\s*'([^']{0,200})'/);
    if (errMatch) return `Error: ${errMatch[1]}`;
    // Fallback: primeros 300 chars limpios
    return raw.replace(/ActionResult\([^)]{0,50}\)/g, "").slice(0, 300).trim();
  }

  if (data.status === "completed") {
    const clean = extractCleanResult(data.result);
    return `✅ Tarea completada${durationStr}\n\n📋 ${data.tarea.split("\n")[0]}\n\n📄 ${clean}`;
  }

  if (data.status === "failed") {
    const clean = extractCleanResult(data.result);
    return `❌ Tarea falló${durationStr}\n\n📋 ${data.tarea.split("\n")[0]}\n\n📄 ${clean}`;
  }

  return `Estado: ${data.status}`;
}