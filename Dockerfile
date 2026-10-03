# Two images from one file:
#   --target web → nginx serving the Vite build and proxying /api to the API
#   --target api → Node server (native Stockfish + SQLite)

# 1) Build the front-end
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# 2) Web: nginx
FROM nginx:alpine AS web
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/dist /usr/share/nginx/html
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf

# 3) API: Node 24 (node:sqlite) + native Stockfish (glibc, so not alpine)
FROM node:24-bookworm-slim AS api
ARG STOCKFISH_VERSION=sf_19
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
  && curl -fsSL "https://github.com/official-stockfish/Stockfish/releases/download/${STOCKFISH_VERSION}/stockfish-linux-x86-64-universal.tar.gz" \
     | tar xz -C /tmp \
  && install -m 755 /tmp/stockfish/stockfish-linux-x86-64-universal /usr/local/bin/stockfish \
  && rm -rf /tmp/stockfish \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.34.3 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY server ./server

ENV NODE_ENV=production \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=3001 \
    STOCKFISH_PATH=/usr/local/bin/stockfish
EXPOSE 3001
CMD ["node", "server/index.mjs"]
