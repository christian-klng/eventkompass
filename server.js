// OKR Event-Tracker (Eventkompass) – Startpunkt. Die App selbst steckt in lib/app.js.
// Daten liegen als JSON-Datei unter DATA_DIR (Standard: ./data), im Container als Volume gemountet.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './lib/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

const { app, store } = await createApp({
  dataDir: DATA_DIR,
  seed: process.env.SEED !== 'false',
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminName: process.env.ADMIN_NAME,
  allowReset: process.env.ALLOW_RESET === 'true',
});

app.listen(PORT, () => {
  console.log(`OKR Event-Tracker läuft auf http://localhost:${PORT}  (Daten: ${store.file})`);
});
