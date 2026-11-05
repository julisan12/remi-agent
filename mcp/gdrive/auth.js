// mcp/gdrive/auth.js
// Ejecutar UNA VEZ para obtener el refresh_token de Google Drive
// Uso: node mcp/gdrive/auth.js

import { google } from "googleapis";
import http from "http";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../config/.env") });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3456";

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: ["https://www.googleapis.com/auth/drive.readonly"],
  prompt: "consent",
});

console.log("\n🔗 Abre este URL en tu navegador:");
console.log(authUrl);
console.log("\n⏳ Esperando callback en http://localhost:3456 ...\n");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  if (!code) { res.end("Sin código."); return; }

  res.end("<h2>✅ Autorizado. Puedes cerrar esta pestaña.</h2>");
  server.close();

  const { tokens } = await oauth2Client.getToken(code);
  console.log("\n✅ Agrega esto a config/.env:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
});

server.listen(3456);
