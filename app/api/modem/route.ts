import { NextRequest, NextResponse } from 'next/server';
import { getModem } from '@/lib/modem';
import { modemLog } from '@/lib/events';

export async function POST(req: NextRequest) {
  const { command } = await req.json() as { command: string };

  if (!command?.trim()) {
    return NextResponse.json({ error: 'No command provided' }, { status: 400 });
  }

  const modem = getModem();
  if (!modem || !modem.isOpen()) {
    return NextResponse.json({ error: 'Modem not connected' }, { status: 503 });
  }

  try {
    modemLog('info', `>>> ${command.trim()}`);
    const response = await modem.sendCommand(command.trim(), 2000);
    modemLog('info', `<<< ${response.trim()}`);
    return NextResponse.json({ response: response.trim() });
  } catch (err) {
    modemLog('error', `Command failed: ${err}`);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
