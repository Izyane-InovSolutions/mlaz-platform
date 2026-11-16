# syntax=docker/dockerfile:1
# The MLAZ API as a container image, for any host that runs containers (no provider is assumed). Two targets:
#
#   docker build -t mlaz-api .                          the API (default target `runtime`)
#   docker build -t mlaz-api-migrate --target migrate .  applies database migrations, then exits
#
# Migrations never run when the API starts: the release process runs the `migrate` image once, then starts or replaces
# the API containers (docs/OPERATIONS.md, "Deploying a release"). Configuration comes only from environment variables
# set by the host's secret store; no .env file is copied into either image.

# Node 24 (Active LTS) is the production runtime, the same major version CI tests on (../.nvmrc); keep the two aligned.
ARG NODE_VERSION=24

# ---- build: dependencies, Prisma client, TypeScript ----
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# `prisma generate` (postinstall) reads prisma.config.ts, which needs the variable set; it never connects.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- migrate: the Prisma CLI and the migrations, nothing else runs here ----
FROM build AS migrate
ENV NODE_ENV=production
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- runtime: production dependencies and the compiled API ----
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: postinstall would run `prisma generate`, a dev tool; the generated client is compiled into dist/.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
# Owner-only scratch space for uploads in progress (UPLOAD_TMP_DIR defaults to the system temp directory).
RUN mkdir -p /tmp/mlaz-uploads && chown node:node /tmp/mlaz-uploads && chmod 700 /tmp/mlaz-uploads
USER node
EXPOSE 3000
# Liveness only: readiness (GET /health, which checks the database) belongs to the load balancer or orchestrator.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# node directly (not npm), so SIGTERM reaches the API and its graceful shutdown runs.
CMD ["node", "dist/index.js"]
