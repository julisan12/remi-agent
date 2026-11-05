// sia-voice-mcp.js — MCP de voz para S.I.A.
// Permite al agente enviar notas de voz por WhatsApp via ElevenLabs + ffmpeg

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execSync } from "child_process";
import https from "https";
import fs from "fs";
import path from "path";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "hpp4J3VqNfWAUOO0d1Us"; // Bella
const TMPDIR = "/tmp/sia-voice";

const server = new McpServer({ name: "sia-voice", version: "1.0.0" });

// Función para descargar audio de ElevenLabs
function generateAudio(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.8 }
    });

    const options = {
      hostname: "api.elevenlabs.io",
      path: `/v1/text-to-speech/${VOICE_ID}`,
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          reject(new Error(`ElevenLabs error ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

server.tool(
  "sia_send_voice_note",
  "Envía una nota de voz por WhatsApp usando la voz de S.I.A. (Bella, ElevenLabs). Úsala cuando el usuario pida audio o cuando la respuesta sea emocional/motivacional y breve.",
  {
    target: z.string().describe("Número de teléfono destino en formato E.164, ej: +521234567890"),
    text: z.string().max(800).describe("Texto que S.I.A. dirá en el audio. Máximo 800 caracteres. Escríbelo como lo dirías hablando, sin markdown ni bullets.")
  },
  async ({ target, text }) => {
    try {
      fs.mkdirSync(TMPDIR, { recursive: true });
      const ts = Date.now();
      const mp3Path = path.join(TMPDIR, `sia_${ts}.mp3`);
      const oggPath = path.join(TMPDIR, `sia_${ts}.ogg`);

      // Generar audio
      const audioBuffer = await generateAudio(text);
      fs.writeFileSync(mp3Path, audioBuffer);

      if (!fs.statSync(mp3Path).size) {
        throw new Error("ElevenLabs no generó audio (archivo vacío)");
      }

      // Convertir a OGG Opus (formato WhatsApp PTT)
      execSync(`ffmpeg -i "${mp3Path}" -c:a libopus -b:a 24k -ar 16000 -ac 1 "${oggPath}" -y -loglevel error`);

      if (!fs.statSync(oggPath).size) {
        throw new Error("ffmpeg no pudo convertir el audio");
      }

      // Enviar via OpenClaw
      const result = execSync(
        `openclaw message send --channel whatsapp --target "${target}" --media "${oggPath}"`,
        { encoding: "utf8" }
      );

      // Limpiar temporales
      fs.unlinkSync(mp3Path);
      fs.unlinkSync(oggPath);

      return {
        content: [{ type: "text", text: `Nota de voz enviada a ${target}. ${result.trim()}` }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error enviando nota de voz: ${err.message}` }],
        isError: true
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
