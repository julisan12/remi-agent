# Imagen base ligera — Node.js 20
FROM node:20-slim

# Instalar dependencias del sistema para Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Decirle a Playwright que use el Chromium del sistema
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copiar dependencias primero (cache layer)
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el resto del proyecto
COPY . .

# Puerto que expone Railway
EXPOSE 3000

# Arrancar el servidor
CMD ["node", "src/server.js"]
