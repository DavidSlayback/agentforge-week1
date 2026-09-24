FROM node:24-alpine
RUN apk add --no-cache poppler-utils tesseract-ocr tesseract-ocr-data-eng
WORKDIR /app
COPY agentforge/package.json agentforge/BUILD_SHA agentforge/
COPY agentforge/src agentforge/src
COPY agentforge/scripts agentforge/scripts
COPY agentforge/test agentforge/test
COPY observability observability
COPY evals/deployed-service-results.json evals/deployed-service-results.json
COPY evals/error-analysis.json evals/error-analysis.json
COPY docs/agentforge/fixtures docs/agentforge/fixtures
COPY docs/agentforge/evidence docs/agentforge/evidence
WORKDIR /app/agentforge
ENV PORT=8787 AGENTFORGE_FIXTURES=/app/docs/agentforge/fixtures/clinical-cases.json
EXPOSE 8787
CMD ["node", "src/server.js"]
