FROM node:24-alpine
RUN apk add --no-cache poppler-utils tesseract-ocr tesseract-ocr-data-eng
WORKDIR /app
COPY agentforge/package.json agentforge/package-lock.json agentforge/BUILD_SHA agentforge/
RUN npm ci --omit=dev --prefix agentforge
COPY agentforge/src agentforge/src
COPY agentforge/scripts agentforge/scripts
COPY agentforge/corpus agentforge/corpus
COPY observability observability
COPY evals/deployed-service-results.json evals/deployed-service-results.json
COPY evals/error-analysis.json evals/error-analysis.json
COPY docs/agentforge/fixtures docs/agentforge/fixtures
COPY docs/agentforge/evidence docs/agentforge/evidence
COPY docs/agentforge/schemas docs/agentforge/schemas
# W3 hardening (H2): no test sources in the image. The running server reads
# nothing under agentforge/test (test/dockerfile-runtime-dirs.test.js runs the
# server with such reads forbidden). The app files stay root-owned and the
# process runs as the unprivileged `node` user; /data (the trace volume,
# AGENTFORGE_TRACE_PATH=/data/...) is created here owned by `node`, so a new
# named volume inherits that owner. An existing root-owned volume needs a
# one-time chown (deploy/vultr/README.md). pdftoppm/tesseract use os.tmpdir().
RUN mkdir -p /data && chown node:node /data
WORKDIR /app/agentforge
ENV PORT=8787 AGENTFORGE_FIXTURES=/app/docs/agentforge/fixtures/clinical-cases.json
USER node
EXPOSE 8787
CMD ["node", "src/server.js"]
