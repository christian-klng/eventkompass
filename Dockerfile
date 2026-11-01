FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js seed.js ./
COPY public ./public
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server.js"]
