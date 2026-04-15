# Preface

I wasn't aware of an existing maintained fork of the original project at the time of this release. If you stumbled across this project but prefer the look and feel of the original project https://github.com/thess/callattendant is being actively maintained.

# Call Attendant Next

A TypeScript/Next.js port of the [callattendant](https://github.com/emxsys/callattendant) Python project by Bruce Schubert — an automated call screener and voicemail system for landlines using a USB modem.

## Supported Modems

**Only hardware modems are supported.** Software modems (winmodems) will not work as they lack the voice mode capabilities required for call screening and audio playback.

| Modem | Recommended Baud Rate | Notes |
|-------|-----------------------|-------|
| US Robotics USR5637 | 115200 | Requires firmware **1.2.23 or later** (check with `ATI7`). Older firmware cannot answer calls — the modem does not go off-hook in response to `AT+VLS=1`. Update via the [USR support page](https://www.usr.com/support/5637) if needed. |
| MultiTech MT9234MU-CDC | 115200 — provides best voice quality | |
| ZOOM 3095 | 115200 — provides best voice quality | |
| Startech USB56KEMH2 | 115200 — provides best voice quality | Conexant CX93010-based |

If you have a hardware modem not on this list and would like support added, open an issue at [foureight84/CallAttendantNext](https://github.com/foureight84/CallAttendantNext/issues).

## Table of Contents

- [Supported Modems](#supported-modems)
- [Stack](#stack)
- [What's New vs. the Original Python Project](#whats-new-vs-the-original-python-project)
- [Roadmap](#roadmap)
- [Getting Started](#getting-started)
  - [Configuration (.env)](#configuration-env)
  - [Environment Variables](#environment-variables)
  - [Piper TTS Setup](#piper-tts-setup)
- [Voicemail Audio Enhancement (RNNoise)](#voicemail-audio-enhancement-rnnoise)
- [Deployment Options](#deployment-options)
- [Docker](#docker)
- [Bare Metal (Raspberry Pi / Linux)](#bare-metal-raspberry-pi--linux)
  - [Run as a Service](#run-as-a-service)
    - [systemd](#systemd)
    - [pm2](#pm2)
    - [supervisord](#supervisord)
    - [OpenRC](#openrc)
- [Updating](#updating)
  - [Docker Update](#docker-update)
  - [Bare Metal Update](#bare-metal-update)
- [Migrating from the Python callattendant](#migrating-from-the-python-callattendant)
  - [Bare Metal Migration](#bare-metal-migration)
  - [Docker Migration](#docker-migration)
  - [Migration Options](#migration-options)
- [Greeting Scripts](#greeting-scripts)
- [SMTP Email Notifications](#smtp-email-notifications-1)
- [MQTT Notifications](#mqtt-notifications-1)
- [Robocall Blocklist Cleanup](#robocall-blocklist-cleanup)
- [DTMF Opt-Out for Blocked Callers](#dtmf-opt-out-for-blocked-callers)
- [Screenshots](#screenshots)

---

## Stack

- **Next.js 15** — frontend and API routes
- **ts-rest + zod** — type-safe REST API contract
- **SQLite** via drizzle-orm + libsql
- **serialport** — serial communication with USB modem
- **Piper TTS** — real-time speech synthesis for greetings
- **ffmpeg** — voicemail encoding (MP3) and audio conversion
- **Vitest** — unit and integration testing
- **Docker** — containerized deployment

## What's New vs. the Original Python Project

- **Non-blocking call handling** — async/await throughout, no blocking main thread
- **Easier debugging** — structured log events streamed to the browser via SSE; Debug Console page
- **Piper TTS instead of WAV files** — greetings are synthesized on demand from `.txt` scripts; no per-voice audio files to manage
- **ffmpeg voicemail encoding** — recordings saved as MP3 (falls back to WAV if ffmpeg is unavailable); filenames match the Python pattern: `{callLogId}_{number}_{name}_{MMDDyy_HHMM}.mp3` (e.g. `42_8005551234_JOHN_SMITH_032621_1423.mp3`)
- **Updated Nomorobo scraping** — adapted for their current website format
- **Improved serial port handling** — faster modem detection, reduced call response time. Optimizations were focused on being able to pick up the call and screen before the second ring. For those with first-call supression support on their telephone, you will never hear an unwanted call.
- **Raspberry Pi GPIO LED support** — toggle via `ENABLE_GPIO=true` in `.env`
- **SMTP email notifications** — send call event emails via any SMTP provider (Gmail, Outlook, iCloud, or custom); configurable per-event triggers (voicemail received, blocked call, all calls); optional MP3 voicemail attachment
- **MQTT notifications** — publish call events as JSON to any MQTT broker after each call; integrates with Home Assistant via the [CallAttendantNext Monitor HACS integration](https://github.com/foureight84/CallAttendantNext_Monitor)
- **Migration script** — import existing call log, whitelist, blocklist, and voicemail recordings from a Python callattendant database

---

## Roadmap
- **SEON API integration** - provide additional Caller ID discovery as well as number reputation to weave out fraudulent and malicious callers that may not be on NOMOROBO's database.
- **Voicemail Transcription** - can't guarantee but something to explore if it is feasible to deploy a Speech-to-text feature. Whisper-cpp is a likely candidate.
- **User Request** - While I am the only one using this app daily, if we get more adoptions and you feel that a must-have feature is missing, then feel free to open a [Feature-Request] ticket in the Issues section.

---

# Getting Started

## Clone the Repository

```bash
git clone https://github.com/foureight84/CallAttendantNext callattendantnext
cd callattendantnext
```

## Configuration (`.env`)

> **Docker users: skip this section.** Docker does not use the `.env` file — all configuration is set via the `environment:` block in `docker-compose.yml`. See [Docker](#docker).

On first launch, a **Setup Wizard** will guide you through all the key settings directly in the web UI — you don't need to configure everything in `.env` upfront. The `.env` file is mainly used to set the serial port and paths that the app needs before it can start.

Create a `.env` file at the project root with at minimum the four required keys:

```bash
SERIAL_PORT=/dev/ttyUSB0
SERIAL_BAUD_RATE=115200
PIPER_BINARY=./piper/piper
PIPER_MODELS_DIR=./piper-models
```

You can also copy `.env.example` as a starting point for all available options:

```bash
cp .env.example .env
```

**On every startup, `.env` values are written to the database as defaults.** This means:
- First run: `.env` seeds all settings into the database
- Subsequent runs: `.env` can override any setting back to a specific value
- Settings changed via the web UI are stored in the database and take effect immediately, but will be overwritten on next restart if `.env` specifies that key

**Four keys are mandatory** — the app will start but will not function correctly without these:

| Key | Example | Description |
|-----|---------|-------------|
| `SERIAL_PORT` | `/dev/tty.usbmodem00000021` | Path to your modem device (`/dev/ttyUSB0` on Linux, `/dev/tty.usbmodem*` on macOS, `COM3` on Windows) |
| `SERIAL_BAUD_RATE` | `115200` | Modem baud rate — `115200` for MT9234MU/Conexant/ZOOM, `57600` for USR 5637 |
| `PIPER_BINARY` | `./piper/piper` | Path to the Piper TTS binary — without this, no greeting will play during calls. See [Piper TTS Setup](#piper-tts-setup) |
| `PIPER_MODELS_DIR` | `./piper-models` | Directory containing `.onnx` voice model files — without this, no voice is available for TTS. See [Piper TTS Setup](#piper-tts-setup) |

All other keys are optional and fall back to sensible defaults.

---

<a name="environment-variables"></a>
<details>
<summary><strong>Environment Variables</strong></summary>

### Required

| Variable | Default | Description |
|----------|---------|-------------|
| `SERIAL_PORT` | `/dev/ttyUSB0` | Path to modem device (e.g. `/dev/ttyUSB0`, `/dev/tty.usbmodem*`, `COM3`) |
| `SERIAL_BAUD_RATE` | `57600` | Modem baud rate — `115200` for MT9234MU/Conexant/ZOOM, `57600` for USR 5637 |
| `PIPER_BINARY` | `piper` | Path to the Piper TTS binary — without this, no greeting plays during calls |
| `PIPER_MODELS_DIR` | `./piper-models` | Directory containing `.onnx` voice model files — without this, no voice is available for TTS |

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port the web UI listens on |
| `DB_PATH` | `./callattendant.db` | Path to the SQLite database file — do not change when using Docker |
| `MESSAGES_DIR` | `./messages` | Directory where voicemail MP3 files are saved — do not change when using Docker |

### Call Screening

| Variable | Default | Description |
|----------|---------|-------------|
| `SCREENING_MODE` | `whitelist,blacklist` | Comma-separated list of active screening modes. Values: `whitelist`, `blacklist` |
| `BLOCK_SERVICE` | `NOMOROBO` | External spam lookup service. Currently only `NOMOROBO` is supported |
| `SPAM_THRESHOLD` | `2` | Nomorobo score at which a caller is considered spam and blocked. `1` = suspicious, `2` = confirmed spam |
| `AUTO_BLOCK_SPAM` | `true` | Automatically add callers to the blocklist when their spam score meets the threshold |
| `RINGS_BEFORE_VM` | `4` | Rings before answering for whitelisted callers |
| `RINGS_BEFORE_VM_SCREENED` | `2` | Rings before answering for screened (unknown) callers |
| `BLOCKLIST_ACTION` | `2` | What to do with blacklisted callers: `1` = hang up silently, `2` = play blocked greeting then hang up, `3` = send to voicemail after N rings |
| `RINGS_BEFORE_VM_BLOCKLIST` | `0` | Rings before voicemail for blacklisted callers when `BLOCKLIST_ACTION=3` |
| `ROBOCALL_CLEANUP_ENABLED` | `false` | Enable periodic re-verification of "Robocall" blocklist entries against Nomorobo. Numbers no longer flagged are removed |
| `ROBOCALL_CLEANUP_CRON` | `0 2 * * 6` | Cron schedule for the cleanup job (5-field syntax, e.g. `0 2 * * 6` = Saturday 2am). Only used when `ROBOCALL_CLEANUP_ENABLED=true` |
| `DTMF_REMOVAL_ENABLED` | `false` | Send a DTMF keypress to blocked callers to request opt-out from their calling list |
| `DTMF_REMOVAL_KEY` | `9` | The DTMF key to send when `DTMF_REMOVAL_ENABLED=true`. Valid values: `0`–`9`, `*`, `#` |

### Piper TTS

| Variable | Default | Description |
|----------|---------|-------------|
| `PIPER_LENGTH_SCALE` | `1.0` | Speech speed multiplier. `1.0` = normal speed; higher values slow speech down. Range: `1.0`–`1.5` |

### Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_FILE` | `./logs/modem.log` | Path to the rotating modem log file |
| `LOG_MAX_BYTES` | `5242880` | Log file size limit in bytes before rotation (default: 5 MB) |
| `LOG_KEEP_FILES` | `2` | Number of rotated log files to retain |

### GPIO

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_GPIO` | `false` | Enable Raspberry Pi GPIO LED indicators. Set to `true` on supported Pi hardware |

### Debugging

| Variable | Default | Description |
|----------|---------|-------------|
| `DEBUG_CONSOLE` | `false` | Enable the Debug Console page in the UI |
| `DIAGNOSTIC_MODE` | `false` | Enable the Diagnostics page for running modem self-tests |
| `SAVE_PCM_DEBUG` | `false` | Save raw PCM audio to disk during voicemail recording for debugging |

### SMTP Email Notifications

| Variable | Default | Description |
|----------|---------|-------------|
| `EMAIL_ENABLED` | `false` | Enable SMTP email notifications |
| `EMAIL_HOST` | _(empty)_ | SMTP server hostname (e.g. `smtp.gmail.com`) |
| `EMAIL_PORT` | `587` | SMTP port — `587` for STARTTLS, `465` for SSL |
| `EMAIL_USER` | _(empty)_ | SMTP username / email address |
| `EMAIL_PASS` | _(empty)_ | SMTP password or app-specific password |
| `EMAIL_FROM` | _(empty)_ | Sender address — defaults to `EMAIL_USER` if blank |
| `EMAIL_TO` | _(empty)_ | Recipient address for notifications |
| `EMAIL_NOTIFY_VOICEMAIL` | `true` | Send email when a voicemail is recorded (with MP3 attached) |
| `EMAIL_NOTIFY_BLOCKED` | `false` | Send email when a call is blocked |
| `EMAIL_NOTIFY_ALL` | `false` | Send email for every call regardless of action |

### MQTT Notifications

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_ENABLED` | `false` | Enable MQTT call event publishing |
| `MQTT_BROKER_URL` | _(empty)_ | MQTT broker URL (e.g. `mqtt://homeassistant.local:1883`) |
| `MQTT_USERNAME` | _(empty)_ | MQTT broker username |
| `MQTT_PASSWORD` | _(empty)_ | MQTT broker password |
| `MQTT_TOPIC_PREFIX` | `callattendant` | Topic prefix — events published to `{prefix}/call` |
| `MQTT_NOTIFY_VOICEMAIL` | `true` | Publish MQTT message when a voicemail is recorded |
| `MQTT_NOTIFY_BLOCKED` | `true` | Publish MQTT message when a call is blocked |
| `MQTT_NOTIFY_ALL` | `false` | Publish MQTT message for every call regardless of action |

</details>

---

## Piper TTS Setup

**Required.** Piper TTS is used to synthesize greeting messages in real time during calls — without it, greetings will not play.

Piper is a fast, lightweight C++ TTS engine optimized for low-latency local inference — well suited for real-time telephony use. While the library is no longer actively maintained, it remains fully functional with modern speech models as long as they are in ONNX format. You need:
1. The Piper binary
2. At least one voice model (`.onnx` + `.onnx.json`) in the `piper-models/` directory

> **`setup.sh` handles both steps automatically** — it downloads the Piper binary for your platform and two default English voice models (`en_US-hfc_female-medium` and `en_US-hfc_male-medium`). Follow the steps below only if you want to download additional or different voice models. See [Deployment Options](#deployment-options) for how to run `setup.sh` for your setup.

### 1. Download Piper Binary

Download the release for your platform from the [rhasspy/piper releases page](https://github.com/rhasspy/piper/releases/tag/2023.11.14-2):

| Platform | File |
|----------|------|
| Linux x86_64 | `piper_linux_x86_64.tar.gz` |
| Linux arm64 (Pi 4/5) | `piper_linux_aarch64.tar.gz` |
| macOS x86_64 | `piper_macos_x64.tar.gz` |
| Windows | `piper_windows_amd64.zip` |

Extract into a `piper/` directory at the project root:

```bash
mkdir -p piper
tar -xzf piper_linux_aarch64.tar.gz --strip-components=1 -C piper
```

Set the path in `.env`:

```env
PIPER_BINARY=./piper/piper
PIPER_MODELS_DIR=./piper-models
```

> **Docker:** the Dockerfile downloads the Linux x86_64 binary automatically. You only need to supply models.

### 2. Download a Voice Model

Voice models are hosted on [Hugging Face — rhasspy/piper-voices](https://huggingface.co/rhasspy/piper-voices/tree/main).

You can use this site to help decide which voice model to use. [https://piper.ttstool.com/](https://piper.ttstool.com/)

Each voice requires **two files**:
- `<model>.onnx` — the model weights
- `<model>.onnx.json` — metadata including sample rate

**Example — US English female (medium quality):**

```bash
mkdir -p piper-models

# Download model + metadata
wget -P piper-models https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx
wget -P piper-models https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json
```

Browse all available voices at: `https://huggingface.co/rhasspy/piper-voices/tree/main`

After downloading, select the model in **Settings → Voice Model** and click **Play** to preview.

---

## Voicemail Audio Enhancement (RNNoise)

Voicemail recordings are processed through an audio filter chain during MP3 conversion to reduce line noise, echo, and static inherent to telephone recordings. The chain uses ffmpeg's `arnndn` filter — a recurrent neural network denoiser trained specifically on speech.

The model files are bundled in `ffmpeg/arnndn/models/` — no download required. They are not subject to copyright (neural network weights are not a creative work) and are derived from the [RNNoise](https://github.com/xiph/rnnoise) project by Jean-Marc Valin / Xiph.Org Foundation (BSD-3-Clause), via [richardpl/arnndn-models](https://github.com/richardpl/arnndn-models).

### Available Models

The default model is **`bd.rnnn`** — the best all-rounder for voicemail use.

| Model | Signal type | Noise type | Best for |
|-------|-------------|------------|----------|
| `bd.rnnn` ⭐ | Voice (incl. coughs/laughs) | Recording noise | General voicemail — callers with background noise |
| `sh.rnnn` | Pure speech | Recording noise | Quiet environments — caller speaking clearly |
| `lq.rnnn` | Voice (incl. coughs/laughs) | General noise | Voice with ambient non-speech sounds |
| `cb.rnnn` | General (music/effects) | Recording noise | Mixed audio |
| `mp.rnnn` | General (music/effects) | General noise | Mixed audio in casual environments |
| `std.rnnn` | Pure speech | General noise | Clean speech in typical indoor environments |

> All models were trained on 48kHz audio but remain effective on the 8kHz mono audio produced by voice modems.

### CPU overhead

RNNoise is lightweight by design (~40 MFLOPS). It processes audio approximately 7× faster than real-time on a Raspberry Pi 3 and 60× faster on x86 — adding negligible overhead to post-call MP3 encoding.

---

## Deployment Options

Choose your preferred deployment method:

| Method | Best for |
|--------|----------|
| [Docker](#docker) | Most users — no Node.js install needed, isolated environment, easy updates |
| [Bare Metal](#bare-metal-raspberry-pi--linux) | Raspberry Pi users who prefer direct control, or environments where Docker isn't available |

---

## Docker

### Build and Run

```bash
# Create required directories and download default voice models
# (safe to re-run — skips anything that already exists)
bash setup.sh

# Or create directories manually
mkdir -p data messages logs piper-models

# Start
docker compose up -d
```

The app will be available at `http://localhost:3000`.

### Notes

- The Dockerfile downloads the piper binary automatically during build
- Mount your modem device via `devices` in `docker-compose.yml`. The format is `host_path:container_path`. If your modem is on `/dev/ttyUSB0` the default config already handles it:
  ```yaml
  devices:
    - /dev/ttyUSB0:/dev/ttyUSB0
  ```
  `SERIAL_PORT` must match the **container-side** path. For example, if you mount `/dev/ttyUSB0` on the host to `/dev/ttyUSB1` inside the container, set `SERIAL_PORT=/dev/ttyUSB1` in `docker-compose.yml`
- `data/`, `messages/`, and `logs/` must exist before first run — Docker will create them automatically on start but as root-owned, which can cause permission issues
- Pass all config via environment variables in `docker-compose.yml` — no `.env` file is loaded inside the container

### Rebuild after code changes

```bash
docker compose up -d --build
```

---

## Bare Metal (Raspberry Pi / Linux)

### Prerequisites

```bash
# Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# ffmpeg and build tools
sudo apt install -y ffmpeg python3 make g++ libudev-dev

# Add your user to the dialout group for serial port access
sudo usermod -aG dialout $USER
# Log out and back in for this to take effect
```

### Install and Build

Choose a setup path:

---

#### Option A — Automated setup (recommended)

Run the included script to create required directories, download the Piper binary for your platform, and download two default English voice models in one step. Docker users can also run this script to create the host directories required by `docker-compose.yml` — the Piper binary download is skipped if it already exists:

```bash
bash setup.sh
```

The script is safe to re-run — it skips anything that already exists. To use a different voice model, see [Piper TTS Setup](#piper-tts-setup).

Then install dependencies and build:

```bash
npm install --legacy-peer-deps
npm run build
```

> **Remember:** Update `SERIAL_PORT` in your `.env` to match your modem's device path (e.g. `/dev/ttyUSB0`). See [Configure](#configure) below.

---

#### Option B — Manual setup

Create the required directories:

```bash
mkdir -p messages logs piper piper-models
```

Download and extract the Piper binary for your platform:

```bash
# Linux arm64 (Raspberry Pi 4/5)
curl -L https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_aarch64.tar.gz \
  | tar -xz --strip-components=1 -C piper

# Linux x86_64
curl -L https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
  | tar -xz --strip-components=1 -C piper
```

Download a voice model — see [Piper TTS Setup](#piper-tts-setup) for all available models:

```bash
wget -P piper-models https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx
wget -P piper-models https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json
```

Install dependencies and build:

```bash
npm install --legacy-peer-deps
npm run build
```

> **Note:** `--legacy-peer-deps` is required due to a peer dependency conflict between `zod` v4 and `@ts-rest/core` which currently expects `zod` v3. This is safe to use — the app is tested and working with `zod` v4.

> **Remember:** Update `SERIAL_PORT` in your `.env` to match your modem's device path (e.g. `/dev/ttyUSB0`). See [Configure](#configure) below.

---

### Configure

```bash
cp .env.example .env
# Edit .env — set SERIAL_PORT and SERIAL_BAUD_RATE at minimum
nano .env
```

### Run

```bash
npm start
```

The app will be available at `http://localhost:3000` (or the port set via `PORT` in `.env`).

### Run as a Service

Choose a startup method to keep Call Attendant running in the background and restart automatically after a reboot or crash:

- [systemd](#systemd) — standard on Raspberry Pi OS, Debian, Ubuntu
- [pm2](#pm2) — Node.js process manager, easiest setup
- [supervisord](#supervisord) — general-purpose process supervisor
- [OpenRC](#openrc) — standard on Alpine Linux

---

#### systemd

```bash
sudo nano /etc/systemd/system/callattendant.service
```

```ini
[Unit]
Description=Call Attendant Next
After=network.target

[Service]
Type=simple
# Set to the user that should run the app; remove this line to run as root (not recommended)
User=pi
# Change to your actual path
WorkingDirectory=/home/pi/callattendantnext
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> `npm start` is equivalent to `npm run start` — both invoke the `start` script in `package.json`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable callattendant
sudo systemctl start callattendant
```

---

#### pm2

pm2 is a Node.js process manager with built-in log management, auto-restart, and startup script generation.

```bash
# Install pm2 globally
sudo npm install -g pm2

# Start the app
pm2 start node_modules/.bin/tsx --name callattendant -- server.ts

# Save the process list and generate startup script
pm2 save
pm2 startup
# Run the command output by pm2 startup (it will look like: sudo env PATH=... pm2 startup ...)
```

**Useful pm2 commands:**
```bash
pm2 status                      # Show running processes
pm2 logs callattendant          # Tail logs
pm2 restart callattendant
pm2 stop callattendant
```

---

#### supervisord

```bash
sudo apt install -y supervisor
sudo nano /etc/supervisor/conf.d/callattendant.conf
```

```ini
[program:callattendant]
command=node_modules/.bin/tsx server.ts
directory=/home/pi/callattendantnext   ; Change to your actual path
user=pi                                ; Change to your username
autostart=true
autorestart=true
stderr_logfile=/var/log/callattendant.err.log
stdout_logfile=/var/log/callattendant.out.log
environment=NODE_ENV="production"
```

```bash
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start callattendant
```

---

#### OpenRC

```bash
sudo nano /etc/init.d/callattendant
```

```sh
#!/sbin/openrc-run

name="callattendant"
description="Call Attendant Next"
directory="/home/pi/callattendantnext"   # Change to your actual path
command="node_modules/.bin/tsx"
command_args="server.ts"
command_user="pi"                        # Change to your username
pidfile="/run/${RC_SVCNAME}.pid"
command_background=true

depend() {
    need net
}
```

```bash
sudo chmod +x /etc/init.d/callattendant
sudo rc-update add callattendant default
sudo rc-service callattendant start
```

### Raspberry Pi GPIO LEDs (Optional)

> **Note:** This feature has not been tested.

Set `ENABLE_GPIO=true` in `.env` to enable LED indicators on GPIO pins (requires the `onoff` package and appropriate wiring). See `lib/modem/gpio.ts` for pin assignments.

---

## Updating

### Docker Update

**Stop the container:**

```bash
docker compose down
```

**Pull the latest code or a specific release:**

```bash
# Latest from main
git pull origin main

# Or a specific version tag
git fetch --tags
git checkout v0.7.0
```

**Rebuild and restart:**

```bash
docker compose up -d --build
```

---

### Bare Metal Update

**Stop the running process:**

```bash
# systemd
sudo systemctl stop callattendant

# pm2
pm2 stop callattendant

# supervisord
sudo supervisorctl stop callattendant

# OpenRC
sudo rc-service callattendant stop
```

**Pull the latest code or a specific release:**

```bash
# Latest from main
git pull origin main

# Or a specific version tag
git fetch --tags
git checkout v0.7.0
```

**Reinstall dependencies and rebuild:**

```bash
npm install --legacy-peer-deps
npm run build
```

**Restart the process:**

```bash
# systemd
sudo systemctl start callattendant

# pm2
pm2 start callattendant

# supervisord
sudo supervisorctl start callattendant

# OpenRC
sudo rc-service callattendant start
```

---

## Migrating from the Python callattendant

If you have an existing [callattendant](https://github.com/emxsys/callattendant) Python installation, use the included migration script to import your call log, whitelist, blocklist, and voicemail recordings.

The schema is identical between both apps — migration is a direct copy. Voicemail WAV files are copied as-is and served without conversion.

> **Note:** Settings are not migrated. The Python app has no Settings table; the new app seeds settings from your `.env` on first startup.

Choose your setup:
- [Bare Metal](#bare-metal-migration) — running directly with Node.js
- [Docker](#docker-migration) — running with Docker Compose

---

### Bare Metal Migration

#### 1. Stop the new app (if running)

```bash
# systemd
sudo systemctl stop callattendant

# pm2
pm2 stop callattendant

# supervisord
sudo supervisorctl stop callattendant

# OpenRC
sudo rc-service callattendant stop

# or just Ctrl-C if running in the foreground
```

#### 2. Dry run — verify counts before committing

```bash
npx tsx scripts/migrate-from-python.ts \
  --old-db /path/to/callattendant/callattendant.db \
  --old-messages /path/to/callattendant/messages \
  --dry-run
```

Check that the row counts look correct before proceeding.

#### 3. Run the migration

```bash
npx tsx scripts/migrate-from-python.ts \
  --old-db /path/to/callattendant/callattendant.db \
  --old-messages /path/to/callattendant/messages
```

The script will print a summary when done:

```
Whitelist : 12 / 12 rows
Blacklist : 47 / 47 rows
CallLog   : 1842 / 1842 rows
Message   : 38 / 38 rows
Files     : 38 copied, 0 already present
Done.
```

#### 4. Start the new app

```bash
# systemd
sudo systemctl start callattendant

# pm2
pm2 start callattendant

# supervisord
sudo supervisorctl start callattendant

# OpenRC
sudo rc-service callattendant start

# or run directly in the foreground
npm start
```

All historical call log entries, whitelist/blocklist entries, and voicemail recordings will be present.

---

### Docker Migration

The new app's database and messages directory are bind-mounted to the host (`./data/` and `./messages/` next to `docker-compose.yml`), so the migration script can reach them directly.

#### 1. Stop the new app

```bash
docker compose down
```

#### 2. Get the old database and messages onto the host

If the old Python callattendant also uses bind mounts, the files are already on the host — note their paths and skip to step 3.

If the old app uses named Docker volumes, copy the files out first:

```bash
# Find the old container name
docker ps -a

# Copy the database
docker cp <old-container>:/app/callattendant.db /tmp/old-callattendant.db

# Copy the messages directory
docker cp <old-container>:/app/messages /tmp/old-messages
```

Adjust `/app/callattendant.db` and `/app/messages` to match the actual paths inside the old container if they differ.

#### 3. Run the migration inside a one-off container

Use the already-built callattendantnext image so Node.js and all dependencies are available — no need to install anything on the host:

```bash
# Dry run first
docker run --rm \
  -v /tmp/old-callattendant.db:/old/callattendant.db:ro \
  -v /tmp/old-messages:/old/messages:ro \
  -v ./data:/app/data \
  -v ./messages:/app/messages \
  callattendantnext-callattendant \
  node_modules/.bin/tsx scripts/migrate-from-python.ts \
    --old-db /old/callattendant.db \
    --old-messages /old/messages \
    --new-db /app/data/callattendant.db \
    --new-messages /app/messages \
    --dry-run
```

```bash
# Run for real (remove --dry-run)
docker run --rm \
  -v /tmp/old-callattendant.db:/old/callattendant.db:ro \
  -v /tmp/old-messages:/old/messages:ro \
  -v ./data:/app/data \
  -v ./messages:/app/messages \
  callattendantnext-callattendant \
  node_modules/.bin/tsx scripts/migrate-from-python.ts \
    --old-db /old/callattendant.db \
    --old-messages /old/messages \
    --new-db /app/data/callattendant.db \
    --new-messages /app/messages
```

The image name (`callattendantnext-callattendant`) is the default Docker Compose generates from the project directory name and service name. If yours differs, check with `docker images`.

If the old app's files are already bind-mounted on the host (e.g. at `./old-messages`), pass the host paths directly — no `docker cp` step needed.

#### 4. Start the new app

```bash
docker compose up -d
```

---

### Migration Options

| Flag | Default | Description |
|------|---------|-------------|
| `--old-db` | *(required)* | Path to the Python app's `callattendant.db` |
| `--old-messages` | *(optional)* | Path to the Python app's `messages/` directory |
| `--new-db` | `./callattendant.db` | Path to the new app's database (Docker: `./data/callattendant.db`) |
| `--new-messages` | `./messages` | Path to the new app's messages directory |
| `--dry-run` | — | Read and count everything; write nothing |

The script is safe to re-run — it uses `INSERT OR IGNORE` for all rows and skips files that already exist in the destination.

---

## Greeting Scripts

Greeting text files live in `public/audio/script/`. Edit them to customize what is spoken. **Do not rename these files** — the filenames are hardcoded and the application will not find them if changed.

Scripts are read from disk on every call — **no restart is required** after editing.

| File | When used |
|------|-----------|
| `general_greeting.txt` | Played when a call is answered and sent to voicemail |
| `please_leave_message.txt` | Played after the greeting, just before recording begins |
| `blocked_greeting.txt` | Played to blocklisted callers before hanging up (when blocklist action is set to "play greeting") |
| `goodbye.txt` | Played when ending an interaction |
| `invalid_response.txt` | Played when an unrecognized input is received |
| `voice_mail_menu.txt` | Played to present the voicemail menu options |

### Bare Metal

Edit the files directly in the project root:

```bash
nano public/audio/script/general_greeting.txt
```

Changes take effect on the next call — no restart needed.

### Docker

The script files are baked into the image by default. To make them editable without rebuilding, mount a local directory over the container's script path.

**Step 1 — Copy the default scripts out of the container:**

```bash
docker cp $(docker compose ps -q callattendant):/app/public/audio/script ./greeting-scripts
```

**Step 2 — Add the volume mount to `docker-compose.yml`:**

```yaml
volumes:
  - ./greeting-scripts:/app/public/audio/script
```

**Step 3 — Recreate the container to apply the mount:**

```bash
docker compose up -d
```

You can now edit any file in `./greeting-scripts/` and changes will take effect on the next call.

---

## SMTP Email Notifications

Configure email alerts in **Settings → Email Notifications**. Supported providers include Gmail, Outlook, iCloud, and any custom SMTP server.

| Setting | Description |
|---------|-------------|
| SMTP Host | e.g. `smtp.gmail.com` |
| Port | `587` (STARTTLS) or `465` (SSL) |
| Username | Your email address |
| Password | Your password or app-specific password |
| From | Sender address (defaults to Username) |
| Send to | Recipient address |

**Notify on** (any combination):
- Voicemail received — sends email with MP3 attachment when a voicemail is recorded
- Blocked call — sends email when a call is blocked
- All calls — sends email for every call regardless of action

### Gmail setup
1. Enable **2-Step Verification** on your Google account
2. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) and create an App Password
3. Use `smtp.gmail.com`, port `587`, your Gmail address, and the 16-character app password

---

## MQTT Notifications

Call Attendant publishes a JSON message to your MQTT broker after every call. Configure in **Settings → MQTT Notifications**.

### Home Assistant Integration

A HACS custom integration is available to automatically create sensors and trigger automations in Home Assistant:

**[CallAttendantNext Monitor — HACS Integration](https://github.com/foureight84/CallAttendantNext_Monitor)**

### Payload format

Published to `{topicPrefix}/call` (default: `callattendant/call`):

```json
{
  "action": "Blocked",
  "name": "SPAM CALLER",
  "number": "8005551234",
  "timestamp": "2026-03-29T17:30:00.000Z",
  "reason": "Nomorobo: Robocall"
}
```

The `voicemail` key is included only when a voicemail was recorded:

```json
{
  "action": "Screened",
  "name": "UNKNOWN",
  "number": "5551234567",
  "timestamp": "2026-03-29T17:31:00.000Z",
  "reason": "Screened: not in whitelist or blacklist",
  "voicemail": "msg_20260329_173100.mp3"
}
```

| Field | Values |
|-------|--------|
| `action` | `Blocked`, `Screened`, `Permitted` |
| `name` | Caller ID name, or `UNKNOWN` |
| `number` | Caller ID number, or `ANONYMOUS` |
| `timestamp` | ISO 8601 UTC |
| `reason` | Screening decision detail |
| `voicemail` | MP3 filename (only present when recorded) |

Messages are fire-and-forget (`retain: false`). Each call produces exactly one message.

---

## Robocall Blocklist Cleanup

Phone numbers flagged as robocallers don't stay with the same owner forever — numbers change hands, get recycled, and reassigned to legitimate individuals or businesses. A number that was a robocall last year may belong to a real person today. The blocklist cleanup feature periodically re-verifies entries that were added with **"Robocall"** as the reason against Nomorobo, and removes any that are no longer flagged.

### How it works

1. Call Attendant scans the blocklist for entries whose reason contains "robocall" (case-insensitive).
2. Each number is checked against Nomorobo with a 10-second delay between lookups to avoid rate limiting.
3. Numbers that are no longer flagged at or above the configured spam threshold are removed from the blocklist.
4. Results are logged to the modem log so you can see exactly what was checked and removed.

### Schedule

The job runs on a configurable cron schedule (default: **Saturday at 2:00 AM**). The schedule uses standard 5-field cron syntax and can be changed in **Settings → Blocklist → Robocall Cleanup**.

You can also trigger a manual run at any time with the **Run Now** button. Because the 10-second inter-lookup delay means a large blocklist can take a while, the UI shows how many numbers remain and an estimated time to completion while the job is running. The Run Now button is disabled while a run is in progress to prevent duplicate jobs.

> **Note:** Only entries added with "Robocall" as the reason are re-verified. Numbers you manually added to the blocklist (e.g. with a custom reason like "Telemarketer") are never touched.

### Enabling

In the UI: **Settings → Blocklist → Robocall Cleanup**, or via environment variables:

```
ROBOCALL_CLEANUP_ENABLED=true
ROBOCALL_CLEANUP_CRON=0 2 * * 6
```

---

## DTMF Opt-Out for Blocked Callers

The FCC requires telemarketers to maintain do-not-call lists and honor removal requests. Many automated calling systems accept a DTMF keypress to remove your number from their list. Call Attendant can send this keypress automatically whenever a blocked caller is answered — before hanging up or recording a voicemail.

> **Note:** Compliance is not guaranteed. Legitimate telemarketers are legally required to honor opt-out requests; robocallers and scammers typically do not.

### How it works

The key is sent after the call is answered, at the point that would normally play a tone or greeting. The exact behavior depends on the configured **Blocklist Action**:

| Blocklist Action | Without DTMF removal | With DTMF removal |
|-----------------|---------------------|-------------------|
| `1` — Hang up silently | Answer → hang up | Answer → send DTMF key → hang up |
| `2` — Play blocked greeting | Answer → greeting → hang up | Answer → greeting → send DTMF key → hang up |
| `3` — Send to voicemail | Answer → greeting → beep → record | Answer → greeting → DTMF key (replaces beep) → record |

### Common opt-out keys

| Key | Usage |
|-----|-------|
| `9` | Most widely used — US robocallers and telemarketing systems |
| `2` | Some political and survey call systems |
| `*` | A small number of automated dialer systems |

### Enabling

In the UI: **Settings → Blocklist → Send DTMF Removal Key**, or via environment variables:

```
DTMF_REMOVAL_ENABLED=true
DTMF_REMOVAL_KEY=9
```

---

## Screenshots

### Dashboard
![Dashboard](https://raw.githubusercontent.com/foureight84/CallAttendantNext/main/screenshots/Dashboard.png)
![Dashboard](https://raw.githubusercontent.com/foureight84/CallAttendantNext/main/screenshots/Dashboard-1.png)

### Call Log
![Call Log](https://raw.githubusercontent.com/foureight84/CallAttendantNext/main/screenshots/Calllog.png)

### Phonebook
![Phonebook](https://raw.githubusercontent.com/foureight84/CallAttendantNext/main/screenshots/Phonebook.png)

### Blocklist
![Blocklist](https://raw.githubusercontent.com/foureight84/CallAttendantNext/main/screenshots/Blocklist.png)

### Voicemail
![Voicemail](https://raw.githubusercontent.com/foureight84/CallAttendantNext/main/screenshots/Voicemail.png)

### Settings
![Settings](https://raw.githubusercontent.com/foureight84/CallAttendantNext/main/screenshots/Settings.png)

### Debug Console
![Debug Console](https://raw.githubusercontent.com/foureight84/CallAttendantNext/main/screenshots/Debug.png)
