# Image de l'API. La version (APP_VERSION) est fixée au build : une image = une version déployable.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
# Uniquement pour simuler une version défectueuse (démo de rollback).
ARG ARTIFICIAL_DELAY_MS=0
ENV ARTIFICIAL_DELAY_MS=${ARTIFICIAL_DELAY_MS}

USER node
EXPOSE 3000
# Sonde sur GET / (l'API n'écoute qu'une fois MongoDB connectée) : le collecteur écarte ses traces (http.route "/").
HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD node -e "fetch('http://localhost:3000/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Traces : l'instrumentation automatique (http, fetch, express, mongodb) est chargée avant l'application,
# comme l'agent Java avec -javaagent (cf. src/instrumentation.ts). Configuration : variables OTEL_*.
CMD ["node", "--import", "./dist/instrumentation.js", "dist/index.js"]
