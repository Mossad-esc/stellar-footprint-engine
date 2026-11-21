# Stage 1: Builder (Node.js + pnpm compiling TypeScript)
FROM node:22-alpine AS builder

WORKDIR /app

# Enable corepack and activate pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package manifests
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including devDependencies for TypeScript build)
RUN pnpm install --frozen-lockfile

# Copy TypeScript configuration and source code
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript to dist/
RUN pnpm run build

# Optional dev target for docker-compose.dev.yml
FROM builder AS dev
CMD ["pnpm", "run", "dev"]

# Stage 2: Production Dependencies
FROM node:22-alpine AS prod-deps

WORKDIR /app

# Enable corepack and activate pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package manifests
COPY package.json pnpm-lock.yaml ./

# Install only production dependencies
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Stage 3: Minimal Distroless Runtime
FROM gcr.io/distroless/nodejs20-debian12 AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Copy compiled artifacts, production dependencies, and runtime metadata
COPY --chown=nonroot:nonroot --from=builder /app/dist ./dist
COPY --chown=nonroot:nonroot --from=prod-deps /app/node_modules ./node_modules
COPY --chown=nonroot:nonroot --from=builder /app/package.json ./package.json
COPY --chown=nonroot:nonroot --from=builder /app/tsconfig.json ./tsconfig.json
COPY --chown=nonroot:nonroot openapi.yaml ./openapi.yaml
COPY --chown=nonroot:nonroot healthcheck.js ./healthcheck.js

# Run as non-root user
USER nonroot

EXPOSE 3000

# Health check using Distroless Node binary (no shell required)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/healthcheck.js"]

# Start the application with tsconfig-paths resolution
CMD ["-r", "tsconfig-paths/register", "dist/index.js"]
