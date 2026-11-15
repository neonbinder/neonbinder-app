# NEO-552: the fake BuySportsCards. Small image, no Chromium. Cloud Run, dev
# project only, built from this directory as the context:
#   docker build --provenance=false --sbom=false -f Dockerfile .
# Single manifest on purpose (NEO-484, see .github/scripts/image-push-report.sh).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json ./
COPY src ./src
# The server only. The recorder (recorder/) runs on a person's machine and
# signs in to real BSC; it is never built into or shipped in this image.
RUN npm run build:server && npm prune --omit=dev

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The non-root user the node image ships.
USER node
EXPOSE 8080
CMD ["node", "dist/src/index.js"]
