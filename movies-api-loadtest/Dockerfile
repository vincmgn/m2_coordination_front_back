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
HEALTHCHECK --interval=5s --timeout=3s --retries=10 \
  CMD node -e "fetch('http://localhost:3000/movies?limit=1').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
