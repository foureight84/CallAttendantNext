#!/usr/bin/env bash
#
# Host-side modem watchdog for Call Attendant Next.
#
# Polls the app's /api/health endpoint. When the modem is wedged (firmware hang)
# or the app is unreachable for FAIL_THRESHOLD consecutive checks, it:
#   1. power-cycles the modem's USB port (USB_RESET_CMD), and
#   2. restarts the container (when RESTART_CONTAINER=true).
#
# This complements the in-app recovery: the app tries a soft reopen first; the
# host only escalates to a physical USB power cycle if the app can't self-heal.
# Run it on the HOST (not inside the container) — only the host can power-cycle
# the USB port behind an unprivileged container.
#
# Configure via environment variables (see deploy/modem-watchdog.service):
#   HEALTH_URL          Health endpoint to poll (default http://localhost:3000/api/health)
#   POLL_INTERVAL       Seconds between checks (default 15)
#   FAIL_THRESHOLD      Consecutive failures before recovery (default 4)
#   USB_RESET_CMD       Command to power-cycle the modem's USB port. Examples:
#                         uhubctl -a cycle -l 1-1 -p 2     (per-port power cycle — best)
#                         usbreset 067b:2303               (USBDEVFS_RESET by vid:pid)
#                       Empty = skip the USB reset (container restart only).
#   RESTART_CONTAINER   "true" to restart the container (default true)
#   CONTAINER_NAME      Container to restart (default callattendant)
#   COOLDOWN            Seconds to wait after a recovery action (default 60)

set -uo pipefail

HEALTH_URL="${HEALTH_URL:-http://localhost:3000/api/health}"
POLL_INTERVAL="${POLL_INTERVAL:-15}"
FAIL_THRESHOLD="${FAIL_THRESHOLD:-4}"
USB_RESET_CMD="${USB_RESET_CMD:-}"
RESTART_CONTAINER="${RESTART_CONTAINER:-true}"
CONTAINER_NAME="${CONTAINER_NAME:-callattendant}"
COOLDOWN="${COOLDOWN:-60}"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [modem-watchdog] $*"; }

recover() {
  log "Recovery threshold reached — recovering modem"

  if [ -n "$USB_RESET_CMD" ]; then
    log "Power-cycling USB: $USB_RESET_CMD"
    if eval "$USB_RESET_CMD"; then
      log "USB reset succeeded"
    else
      log "USB reset command failed (exit $?)"
    fi
    # Give the device a moment to re-enumerate before the app reopens it.
    sleep 5
  else
    log "USB_RESET_CMD not set — skipping USB power cycle"
  fi

  if [ "$RESTART_CONTAINER" = "true" ]; then
    log "Restarting container: $CONTAINER_NAME"
    if docker restart "$CONTAINER_NAME" >/dev/null; then
      log "Container restarted"
    else
      log "docker restart failed (is CONTAINER_NAME correct and docker accessible?)"
    fi
  fi
}

log "Starting — polling $HEALTH_URL every ${POLL_INTERVAL}s (threshold ${FAIL_THRESHOLD})"

fails=0
while true; do
  if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
    if [ "$fails" -ne 0 ]; then log "Modem healthy again"; fi
    fails=0
  else
    fails=$((fails + 1))
    log "Health check failed (${fails}/${FAIL_THRESHOLD})"
    if [ "$fails" -ge "$FAIL_THRESHOLD" ]; then
      recover
      fails=0
      log "Cooldown ${COOLDOWN}s"
      sleep "$COOLDOWN"
    fi
  fi
  sleep "$POLL_INTERVAL"
done
