# Patient dashboard (React SPA + Fastify BFF), built from the repo root:
#   docker build -f dashboard/Dockerfile .
# The build stage runs the same gate as the pre-commit hook (typecheck, lint,
# tests, vite build + bundle budget); the runtime stage holds only production
# dependencies, the BFF/core sources (run by Node 24's type stripping) and the
# built SPA.
FROM node:24-alpine AS build
WORKDIR /app/dashboard
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run check

FROM node:24-alpine
WORKDIR /app/dashboard
ENV NODE_ENV=production PORT=8790
COPY dashboard/package.json dashboard/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY dashboard/BUILD_SHA ./BUILD_SHA
COPY dashboard/core ./core
COPY dashboard/bff/src ./bff/src
COPY --from=build /app/dashboard/web/dist ./web/dist
USER node
EXPOSE 8790
CMD ["node", "bff/src/server.ts"]
