# syntax=docker/dockerfile:1.6
#
# Multi-stage Dockerfile for Reborn Apps (reborn-task + reborn-notes).
#
# Targets:
#   - reborn-task  : production runtime for reborn-task (port 4200)
#   - reborn-notes : production runtime for reborn-notes (port 4201)
#
# Build examples:
#   docker build --target reborn-task  -t reborn-task  .
#   docker build --target reborn-notes -t reborn-notes .
#
# Used by docker-compose.prod.yml via `build.target`.

# ─── Base: shared Node + pnpm layer ────────────────────────────
FROM node:20.20.2-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@10 --quiet

# ─── Deps: install workspace + build shared packages ───────────
# Kept separate from app builds so its cache is reused between task/notes.
FROM base AS deps
# Dummy DATABASE_URL so `prisma generate` (package postinstall) does not fail.
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" \
    NX_DAEMON=false
COPY . .
RUN pnpm install --frozen-lockfile
# @reborn/database ships as compiled dist (apps resolve via package.json main),
# so it must be built explicitly before building the SvelteKit apps.
RUN pnpm nx build @reborn/database

# ─── Build: reborn-task ────────────────────────────────────────
# SvelteKit bakes PUBLIC_* env vars and NODE_ENV at build time, so each app
# needs its own build stage with the correct env. PUBLIC_SITE_URL is a build
# ARG so non-reapps.eu deployments can override via --build-arg.
FROM deps AS build-task
ARG PUBLIC_SITE_URL=https://reapps.eu
ENV NODE_ENV=production \
    PUBLIC_BASE_PATH=/task \
    PUBLIC_SITE_URL=${PUBLIC_SITE_URL}
RUN pnpm nx build reborn-task

# ─── Build: reborn-notes ───────────────────────────────────────
FROM deps AS build-notes
ARG PUBLIC_SITE_URL=https://reapps.eu
ENV NODE_ENV=production \
    PUBLIC_BASE_PATH=/notes \
    PUBLIC_SITE_URL=${PUBLIC_SITE_URL}
RUN pnpm nx build reborn-notes

# ─── Runtime: reborn-task ──────────────────────────────────────
FROM base AS reborn-task
ENV NODE_ENV=production
COPY --from=build-task --chown=node:node /app /app
USER node
EXPOSE 4200
# Prisma migrations run on boot (idempotent). Only reborn-task runs them —
# reborn-notes shares the same DB schema.
CMD ["sh", "-c", "pnpm --filter @reborn/database exec prisma migrate deploy && exec node apps/reborn-task/build"]

# ─── Runtime: reborn-notes ─────────────────────────────────────
FROM base AS reborn-notes
ENV NODE_ENV=production
COPY --from=build-notes --chown=node:node /app /app
USER node
EXPOSE 4201
CMD ["node", "apps/reborn-notes/build"]
