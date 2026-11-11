# syntax=docker/dockerfile:1.7
# Targets: api (public API, api-ops and worker share this image), web, ops.
FROM node:24-slim AS deps
WORKDIR /repo
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/ops/package.json apps/ops/
COPY packages/shared/package.json packages/shared/
COPY packages/i18n/package.json packages/i18n/
COPY packages/ui/package.json packages/ui/
COPY e2e/package.json e2e/
RUN npm ci

FROM deps AS build
COPY . .
RUN npx turbo run build --env-mode=loose \
      --filter=@parkshield/api --filter=@parkshield/web --filter=@parkshield/ops

FROM build AS prod-deps
RUN npm prune --omit=dev

FROM node:24-slim AS api
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/packages/shared/package.json ./packages/shared/
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/i18n/package.json ./packages/i18n/
COPY --from=build /repo/packages/i18n/dist ./packages/i18n/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY db/migrations ./db/migrations
WORKDIR /repo/apps/api
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]

FROM node:24-slim AS web
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
CMD ["node", "apps/web/server.js"]

FROM node:24-slim AS ops
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY --from=build /repo/apps/ops/.next/standalone ./
COPY --from=build /repo/apps/ops/.next/static ./apps/ops/.next/static
USER node
CMD ["node", "apps/ops/server.js"]
