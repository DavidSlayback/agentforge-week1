FROM node:24-alpine
WORKDIR /app
COPY agentforge/package.json agentforge/package.json
COPY agentforge/src agentforge/src
COPY agentforge/test agentforge/test
COPY observability observability
COPY docs/agentforge/fixtures docs/agentforge/fixtures
WORKDIR /app/agentforge
ENV PORT=8787 AGENTFORGE_FIXTURES=/app/docs/agentforge/fixtures/clinical-cases.json
EXPOSE 8787
CMD ["node", "src/server.js"]
