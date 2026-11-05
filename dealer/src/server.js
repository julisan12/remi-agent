// src/server.js — Servidor principal de Dealer
import 'dotenv/config';
import express from 'express';

process.on('uncaughtException', (err) => {
  console.error('❌ uncaughtException:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ unhandledRejection:', reason);
});

import { initWhatsApp, waRoutes, restoreTimers } from './whatsapp.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', agent: 'Dealer', version: '1.0.0', timestamp: new Date().toISOString() });
});

waRoutes(app);

app.listen(PORT, () => {
  console.log(`\n🤖 Dealer v1.0 arriba en puerto ${PORT}`);
  console.log(`🕐 ${new Date().toLocaleString()}\n`);
  initWhatsApp().catch(err => console.error('Error iniciando WhatsApp:', err));
  restoreTimers().catch(err => console.error('Error restaurando timers:', err));
});
