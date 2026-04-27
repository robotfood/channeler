FROM node:24.15.0-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
RUN sed -i 's/Components: main/Components: main contrib non-free non-free-firmware/' /etc/apt/sources.list.d/debian.sources \
  && apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    vainfo \
  && for package in intel-media-va-driver i965-va-driver libvpl2 libmfx1; do \
      candidate="$(apt-cache policy "$package" | awk '/Candidate:/ {print $2}')"; \
      if [ -n "$candidate" ] && [ "$candidate" != "(none)" ]; then \
        apt-get install -y --no-install-recommends "$package"; \
      fi; \
    done \
  && rm -rf /var/lib/apt/lists/*
ARG VERSION=dev
LABEL org.opencontainers.image.version="${VERSION}"
ENV NODE_ENV=production
ENV DATA_PATH=/app/data
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.js"]
