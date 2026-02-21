FROM node:20-alpine

WORKDIR /app

# Copy root workspace config (tsconfig.json needed by extends in app tsconfigs)
COPY package.json package-lock.json turbo.json tsconfig.json ./

# Copy workspace package.json files for dependency resolution
COPY apps/frontend/package.json apps/frontend/
COPY packages/shared-types/package.json packages/shared-types/

# Install all dependencies (workspace-aware)
RUN npm ci --workspace=apps/frontend --workspace=packages/shared-types --include-workspace-root

# Copy shared-types source (needed by frontend)
COPY packages/shared-types/ packages/shared-types/

# Copy frontend source
COPY apps/frontend/ apps/frontend/

WORKDIR /app/apps/frontend

EXPOSE 5173

# Dev mode: vite dev server with host 0.0.0.0 so it's accessible outside container
CMD ["npx", "vite", "--host", "0.0.0.0"]
