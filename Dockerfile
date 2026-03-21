FROM node:22-slim

# Install system dependencies
# - ffmpeg: voicemail MP3 encoding
# - python3, make, g++: node-gyp for serialport native bindings
# - libudev-dev: required by serialport on Linux
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    make \
    g++ \
    libudev-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Download piper TTS with all shared libraries and espeak-ng-data
RUN curl -L https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
    | tar -xz -C /opt
ENV PIPER_BINARY=/opt/piper/piper

WORKDIR /app

# Install dependencies first (layer cache)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copy source and build Next.js
COPY . .
RUN npm run build

# Create data directory
RUN mkdir -p messages

EXPOSE 3000

# Use tsx directly — env vars are injected via Docker/compose, no .env file needed
CMD ["node_modules/.bin/tsx", "server.ts"]
