# ─── Stage 1: Builder ────────────────────────────────────────────────────────
# Installs build tools needed for native node modules (serialport), runs
# npm ci to compile bindings, then builds the Next.js app.
# Build tools (python3, make, g++) are NOT carried into the final image.
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libudev-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

# ─── Stage 2: Runner ─────────────────────────────────────────────────────────
# Lean runtime image — only ffmpeg, curl, piper, and compiled app artifacts.
# No build tools.
FROM node:22-slim AS runner

# Runtime system dependencies only
# - ffmpeg: voicemail MP3 encoding and audio filter chain
# - curl: used during build to download piper (kept slim — no build tools)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Download piper TTS binary in its own layer so it caches independently
# of both apt packages and app code changes.
# TARGETARCH is set automatically by buildx: amd64, arm64, or arm.
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      amd64) PIPER_FILE="piper_linux_x86_64.tar.gz" ;; \
      arm64) PIPER_FILE="piper_linux_aarch64.tar.gz" ;; \
      arm)   PIPER_FILE="piper_linux_armv7.tar.gz" ;; \
      *)     echo "Unsupported architecture: $TARGETARCH" && exit 1 ;; \
    esac && \
    curl -L "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/${PIPER_FILE}" \
    | tar -xz -C /opt \
    && ln -s /opt/piper/piper /usr/bin/piper

WORKDIR /app

# Copy compiled artifacts from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/ffmpeg ./ffmpeg

RUN mkdir -p messages

EXPOSE 3000

CMD ["node_modules/.bin/tsx", "server.ts"]
