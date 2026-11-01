FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.js seed.js ./
COPY lib ./lib
COPY public ./public
# Code lesbar machen (lokale Dateien haben teils Rechte 600), Datenverzeichnis gehört dem node-Nutzer –
# neue Docker-Volumes übernehmen diese Rechte.
RUN chmod -R a+rX /app && mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "server.js"]
