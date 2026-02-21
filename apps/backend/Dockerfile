FROM node:20-alpine

WORKDIR /app

# Copy root workspace config (tsconfig.json needed by extends in app tsconfigs)
COPY package.json package-lock.json turbo.json tsconfig.json ./

# Copy workspace package.json files for dependency resolution
COPY apps/backend/package.json apps/backend/
COPY packages/shared-types/package.json packages/shared-types/

# Install all dependencies (workspace-aware)
RUN npm ci --workspace=apps/backend --workspace=packages/shared-types --include-workspace-root

# Install tsx for fast TypeScript execution
RUN npm install -g tsx

# Copy shared-types source (needed by backend)
COPY packages/shared-types/ packages/shared-types/

# Copy backend source
COPY apps/backend/ apps/backend/

WORKDIR /app/apps/backend

EXPOSE 3000

# Run with tsx (fast ESM-compatible TS runner)
CMD ["tsx", "src/server.ts"]
