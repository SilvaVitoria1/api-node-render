# Imagem com Chrome de verdade instalado via apt (o apt resolve todas as
# dependencias de sistema do Chromium, que sao dezenas e mudam de versao).
FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends wget gnupg ca-certificates fonts-liberation \
  && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends google-chrome-stable \
  && rm -rf /var/lib/apt/lists/*

# Nao baixa o Chromium do puppeteer: usamos o Chrome instalado acima.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

EXPOSE 3000
CMD ["node", "index.js"]
