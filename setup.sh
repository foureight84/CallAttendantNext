#!/usr/bin/env bash
# setup.sh — One-time setup script for Call Attendant Next
# Creates required directories, downloads the Piper TTS binary (bare metal only),
# and downloads two default English voice models.
# Run from the project root: bash setup.sh

set -euo pipefail

PIPER_RELEASE="2023.11.14-2"
PIPER_BASE_URL="https://github.com/rhasspy/piper/releases/download/${PIPER_RELEASE}"
HF_BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main"

MODELS=(
  "en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx"
  "en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json"
  "en/en_US/hfc_male/medium/en_US-hfc_male-medium.onnx"
  "en/en_US/hfc_male/medium/en_US-hfc_male-medium.onnx.json"
)

# ── Helpers ──────────────────────────────────────────────────────────────────

info()    { echo "[setup] $*"; }
success() { echo "[setup] ✓ $*"; }
skip()    { echo "[setup] — $* (already exists, skipping)"; }

require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "[setup] ERROR: '$1' is required but not installed. Install it and re-run." >&2
    exit 1
  fi
}

# ── Preflight ─────────────────────────────────────────────────────────────────

require_cmd curl
require_cmd tar

# ── Detect architecture ───────────────────────────────────────────────────────

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)          PIPER_ARCHIVE="piper_linux_x86_64.tar.gz" ;;
  aarch64|arm64)   PIPER_ARCHIVE="piper_linux_aarch64.tar.gz" ;;
  armv7l)          PIPER_ARCHIVE="piper_linux_armv7.tar.gz" ;;
  *)
    echo "[setup] ERROR: Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

info "Detected architecture: $ARCH → $PIPER_ARCHIVE"

# ── Create directories ────────────────────────────────────────────────────────

for dir in data messages logs piper piper-models; do
  if [ -d "$dir" ]; then
    skip "Directory '$dir'"
  else
    mkdir -p "$dir"
    success "Created '$dir/'"
  fi
done

# ── Download and extract Piper binary (bare metal only) ──────────────────────
# Docker downloads the Piper binary automatically during image build.
# This step is skipped if the binary already exists.

if [ -f "piper/piper" ]; then
  skip "Piper binary (piper/piper)"
else
  info "Downloading Piper binary ($PIPER_ARCHIVE)..."
  curl -L --progress-bar \
    "${PIPER_BASE_URL}/${PIPER_ARCHIVE}" \
    | tar -xz --strip-components=1 -C piper
  success "Piper binary extracted to piper/"
fi

# ── Download voice models ─────────────────────────────────────────────────────

for model_path in "${MODELS[@]}"; do
  filename=$(basename "$model_path")
  dest="piper-models/$filename"

  if [ -f "$dest" ]; then
    skip "$filename"
  else
    info "Downloading $filename..."
    curl -L --progress-bar \
      "${HF_BASE_URL}/${model_path}" \
      -o "$dest"
    success "Downloaded $filename"
  fi
done

# ── .env reminder ─────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────────────────"
echo " Setup complete!"
echo ""
echo " Next steps:"
if [ ! -f ".env" ]; then
  echo "  1. Create your .env file:"
  echo ""
  echo "     cat > .env <<'EOF'"
  echo "     SERIAL_PORT=/dev/ttyUSB0"
  echo "     SERIAL_BAUD_RATE=115200"
  echo "     PIPER_BINARY=./piper/piper"
  echo "     PIPER_MODELS_DIR=./piper-models"
  echo "     EOF"
  echo ""
  echo "     (Update SERIAL_PORT to match your modem device)"
  echo ""
  echo "  2. Install dependencies and build:"
  echo "     npm install --legacy-peer-deps && npm run build"
  echo ""
  echo "  3. Start the app:"
  echo "     npm start"
else
  echo "  1. Install dependencies and build:"
  echo "     npm install --legacy-peer-deps && npm run build"
  echo ""
  echo "  2. Start the app:"
  echo "     npm start"
fi
echo "────────────────────────────────────────────────────"
