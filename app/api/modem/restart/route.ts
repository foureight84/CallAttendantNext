import { NextResponse } from 'next/server';
import { restartDaemon } from '@/lib/modem';
import { modemLog } from '@/lib/events';

export async function POST() {
  try {
    modemLog('info', 'Modem restart requested via debug console');
    await restartDaemon();
    return NextResponse.json({ ok: true });
  } catch (err) {
    modemLog('error', `Restart failed: ${err}`);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
