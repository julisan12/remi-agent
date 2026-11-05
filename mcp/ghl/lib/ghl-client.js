// lib/ghl-client.js
// Cliente base para todas las llamadas a la API de GoHighLevel

import axios from "axios";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../config/.env") });

const client = axios.create({
  baseURL: process.env.GHL_BASE_URL,
  headers: {
    Authorization: `Bearer ${process.env.GHL_API_KEY}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  },
});

// Interceptor para loggear errores sin exponer el token
client.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const message = err.response?.data?.message || err.message;
    throw new Error(`GHL API Error [${status}]: ${message}`);
  }
);

export const locationId = process.env.GHL_LOCATION_ID;
export default client;
