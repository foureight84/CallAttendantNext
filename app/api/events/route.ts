import { callEvents, getLogBuffer } from '@/lib/events';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const enqueue = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // client disconnected
        }
      };

      // Send buffered logs immediately so the debug console has history on connect
      for (const entry of getLogBuffer()) {
        enqueue({ type: 'modem-log', payload: entry });
      }

      enqueue({ type: 'connected' });

      const incomingCallHandler    = (data: unknown) => enqueue({ type: 'incoming-call', payload: data });
      const voicemailHandler       = (data: unknown) => enqueue({ type: 'new-voicemail', payload: data });
      const voicemailPlayedHandler = ()              => enqueue({ type: 'voicemail-played' });
      const voicemailNewHandler    = ()              => enqueue({ type: 'voicemail-new' });
      const logHandler             = (data: unknown) => enqueue({ type: 'modem-log', payload: data });
      const diagnosticHandler      = (data: unknown) => enqueue({ type: 'diagnostic-update', payload: data });

      callEvents.on('incoming-call',    incomingCallHandler);
      callEvents.on('new-voicemail',    voicemailHandler);
      callEvents.on('voicemail-played', voicemailPlayedHandler);
      callEvents.on('voicemail-new',    voicemailNewHandler);
      callEvents.on('modem-log',        logHandler);
      callEvents.on('diagnostic-update', diagnosticHandler);

      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')); }
        catch { clearInterval(heartbeat); }
      }, 30000);

      cleanup = () => {
        clearInterval(heartbeat);
        callEvents.removeListener('incoming-call',    incomingCallHandler);
        callEvents.removeListener('new-voicemail',    voicemailHandler);
        callEvents.removeListener('voicemail-played', voicemailPlayedHandler);
        callEvents.removeListener('voicemail-new',    voicemailNewHandler);
        callEvents.removeListener('modem-log',        logHandler);
        callEvents.removeListener('diagnostic-update', diagnosticHandler);
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
