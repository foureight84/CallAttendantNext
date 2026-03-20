'use client';

import { useEffect } from 'react';
import { notifications } from '@mantine/notifications';

interface IncomingCallPayload {
  callLogId: number;
  name: string;
  number: string;
  date: string;
  time: string;
  action: 'Permitted' | 'Blocked' | 'Screened';
  reason: string;
}

const actionColors: Record<string, string> = {
  Permitted: 'green',
  Blocked: 'red',
  Screened: 'yellow',
};

const actionIcons: Record<string, string> = {
  Permitted: '✅',
  Blocked: '🚫',
  Screened: '⚠️',
};

export function CallNotification() {
  useEffect(() => {
    const evtSource = new EventSource('/api/events');

    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type: string; payload?: IncomingCallPayload };

        if (data.type === 'incoming-call' && data.payload) {
          const { name, number, action, reason } = data.payload;
          notifications.show({
            title: `${actionIcons[action] ?? '📞'} Incoming Call — ${action}`,
            message: `${name ?? 'Unknown'} (${number ?? 'Unknown'})\n${reason}`,
            color: actionColors[action] ?? 'blue',
            autoClose: 8000,
          });
        }

        if (data.type === 'new-voicemail') {
          notifications.show({
            title: '📬 New Voicemail',
            message: 'You have a new voicemail message.',
            color: 'violet',
            autoClose: 10000,
          });
        }
      } catch {
        // Ignore parse errors (heartbeat comments, etc.)
      }
    };

    evtSource.onerror = () => {
      // SSE will auto-reconnect; suppress console noise
    };

    return () => evtSource.close();
  }, []);

  return null;
}
