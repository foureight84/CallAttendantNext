import { NextResponse } from 'next/server';
import { getModem, isRecovering } from '@/lib/modem';
import { config } from '@/lib/config';

/**
 * Health endpoint for external watchdogs (host systemd service, Docker
 * healthcheck, uptime monitors). Returns HTTP 200 when the modem is connected
 * and responsive, 503 when it is missing or wedged (firmware hang) so a watchdog
 * can power-cycle the USB device and/or restart the container.
 */
export async function GET() {
  const modem = getModem();
  const connected = modem?.isOpen() ?? false;
  const wedged = modem?.isWedged() ?? false;
  const recovering = isRecovering();

  // Demo mode (no serial port present) is reported healthy so the watchdog
  // doesn't fight a deliberately port-less deployment. A wedged or closed modem
  // when a port is configured is unhealthy.
  const portPresent = modem != null;
  const healthy = !portPresent || (connected && !wedged);

  return NextResponse.json(
    {
      ok: healthy,
      modemConnected: connected,
      modemWedged: wedged,
      recovering,
      port: config.serialPort,
    },
    { status: healthy ? 200 : 503 },
  );
}
