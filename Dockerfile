# syntax=docker/dockerfile:1

# Build stage: compile TypeScript with the dev toolchain.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npx tsc -p . && npm prune --omit=dev

# Runtime stage: compiled output only, running as an unprivileged user.
FROM node:24-alpine
ENV NODE_ENV=production \
    DATABASE_PATH=/app/data/bot.db
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/src ./dist/src
RUN mkdir -p /app/data && chown node:node /app/data
USER node
# Conversations, orders and settings live here. Mount a volume to keep them.
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/healthz" || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/src/index.js"]
