FROM node:22-bookworm-slim AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS ocr-data
WORKDIR /ocr
RUN npm init -y >/dev/null 2>&1 \
    && npm install --ignore-scripts --no-audit --no-fund @tesseract.js-data/eng@1.0.0 \
    && cp node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz /ocr/eng.traineddata.gz

FROM node:22-bookworm-slim AS migrator
WORKDIR /app
ENV NODE_ENV=production
RUN npm init -y >/dev/null 2>&1 \
    && npm install --omit=dev --ignore-scripts --no-audit --no-fund pg@8.13.1 dotenv@16.4.7 \
    && npm cache clean --force \
    && groupadd -r app \
    && useradd -r -g app app
COPY --from=builder /build/dist/database/migrate.js ./dist/database/migrate.js
COPY migrations ./migrations
USER app
CMD ["node", "dist/database/migrate.js"]

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force
COPY --from=ocr-data /ocr/eng.traineddata.gz /app/tessdata/eng.traineddata.gz
COPY --from=builder /build/dist ./dist
COPY migrations ./migrations
RUN groupadd -r app \
    && useradd -r -g app app \
    && mkdir -p /app/uploads \
    && chown app:app /app/uploads
USER app
EXPOSE 7000
CMD ["node", "dist/main.js"]
