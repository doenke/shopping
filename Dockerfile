# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
# x.yy.zzz, computed by CI (scripts/version.mjs); declared late so it does not invalidate the install layer.
ARG APP_VERSION=dev
RUN APP_VERSION=$APP_VERSION pnpm --filter @shopping/web build \
 && pnpm --filter @shopping/server build \
 && pnpm --filter @shopping/server deploy --prod --legacy /out

FROM node:22-alpine
ARG APP_VERSION=dev
LABEL org.opencontainers.image.version=$APP_VERSION
WORKDIR /app
ENV APP_VERSION=$APP_VERSION \
    NODE_ENV=production \
    PORT=3000 \
    WEB_DIST=/app/web \
    MIGRATIONS_DIR=/app/drizzle
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/drizzle ./drizzle
COPY --from=build /app/apps/web/dist ./web
# Fails the build if the image library has no binary for this platform (musl, amd64/arm64).
RUN node -e "require('sharp')"
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1
CMD ["node", "dist/main.js"]
