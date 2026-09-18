FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      fonts-dejavu-core \
      fonts-liberation \
      imagemagick \
      libreoffice-impress \
      poppler-utils \
      python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/deck
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

ENV NODE_PATH=/opt/deck/node_modules
WORKDIR /work
