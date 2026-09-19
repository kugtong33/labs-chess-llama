FROM docker.io/library/node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS build

WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY web/package.json web/package.json
COPY packages/chess-domain/package.json packages/chess-domain/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/llama-protocol/package.json packages/llama-protocol/package.json
COPY packages/operations/package.json packages/operations/package.json
COPY packages/stockfish-adapter/package.json packages/stockfish-adapter/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY web web
RUN pnpm --filter @chess-llama/web... build

FROM docker.io/library/node:24-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /workspace/web/dist /app/dist
COPY --from=build --chown=node:node /workspace/web/server.mjs /app/server.mjs
USER node
EXPOSE 4173
CMD ["node", "/app/server.mjs"]
