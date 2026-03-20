'use client';

import { useCallback, useEffect, useRef, useState, KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { Stack, Title, Card, Group, Badge, Text, Switch, Button, Code, ScrollArea, TextInput, ActionIcon, SegmentedControl } from '@mantine/core';
import type { ModemLogEntry, LogLevel } from '@/lib/events';

const levelColor: Record<LogLevel, string> = {
  info: 'blue',
  warn: 'yellow',
  error: 'red',
  data: 'gray',
};

const COMMON_COMMANDS = ['ATI', 'ATZ', 'ATE0', 'AT+VCID=1', 'AT+FCLASS?', 'ATH', 'ATA', 'AT'];
const MAX_LINES = 2000;

export default function DebugPage() {
  const router = useRouter();

  // Stream mode state
  const [streamLogs, setStreamLogs] = useState<ModemLogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const pendingRef = useRef<ModemLogEntry[]>([]);

  // Log mode state
  const [logEntries, setLogEntries] = useState<ModemLogEntry[]>([]);
  const [loadingLog, setLoadingLog] = useState(false);

  // Shared state
  const [mode, setMode] = useState<'stream' | 'log'>('stream');
  const [paused, setPaused] = useState(false);
  const [showData, setShowData] = useState(true);
  const [command, setCommand] = useState('');
  const [sending, setSending] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const viewport = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  pausedRef.current = paused;

  useEffect(() => {
    apiClient.settings.get().then(s => {
      if (!s.debugConsole) router.replace('/');
    }).catch(() => {});
  }, [router]);

  const fetchLogHistory = useCallback(async () => {
    setLoadingLog(true);
    try {
      const res = await fetch('/api/logs?lines=2000');
      if (res.ok) {
        setLogEntries(await res.json() as ModemLogEntry[]);
      }
    } finally {
      setLoadingLog(false);
    }
  }, []);

  // Fetch log history when entering Log mode
  useEffect(() => {
    if (mode === 'log') fetchLogHistory();
  }, [mode, fetchLogHistory]);

  // Auto-refresh every 5s in Log mode (pauses when paused toggle is on)
  useEffect(() => {
    if (mode !== 'log') return;
    const id = setInterval(() => {
      if (!pausedRef.current) fetchLogHistory();
    }, 5000);
    return () => clearInterval(id);
  }, [mode, fetchLogHistory]);

  const restartModem = async () => {
    setRestarting(true);
    try {
      const res = await fetch('/api/modem/restart', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        setStreamLogs(prev => {
          const entry = { ts: new Date().toISOString(), level: 'error' as const, msg: `Restart failed: ${err.error}` };
          const next = [...prev, entry];
          return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
        });
      }
    } finally {
      setRestarting(false);
    }
  };

  const scrollToBottom = () => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: 'smooth' });
  };

  // Flush pending SSE entries into state at 10fps to avoid per-message re-renders during data floods
  useEffect(() => {
    const id = setInterval(() => {
      if (pendingRef.current.length === 0) return;
      const toAdd = pendingRef.current;
      pendingRef.current = [];
      setStreamLogs(prev => {
        const next = [...prev, ...toAdd];
        return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
      });
    }, 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const evtSource = new EventSource('/api/events');
    evtSource.onopen = () => setConnected(true);
    evtSource.onerror = () => setConnected(false);
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type: string; payload?: ModemLogEntry };
        if (data.type === 'modem-log' && data.payload) {
          if (pausedRef.current) return;
          pendingRef.current.push(data.payload);
        }
      } catch {}
    };
    return () => evtSource.close();
  }, []);

  useEffect(() => {
    if (!paused) scrollToBottom();
  }, [streamLogs, logEntries, paused]);

  const sendCommand = async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    setSending(true);
    setHistory(prev => [trimmed, ...prev.filter(c => c !== trimmed)].slice(0, 50));
    setHistoryIdx(-1);
    setCommand('');
    try {
      const res = await fetch('/api/modem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        setStreamLogs(prev => {
          const entry = { ts: new Date().toISOString(), level: 'error' as const, msg: err.error };
          const next = [...prev, entry];
          return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
        });
      }
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      sendCommand(command);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const idx = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(idx);
      setCommand(history[idx] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const idx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(idx);
      setCommand(idx === -1 ? '' : (history[idx] ?? ''));
    }
  };

  const logs = mode === 'stream' ? streamLogs : logEntries;
  const filtered = showData && mode === 'stream' ? logs : logs.filter(l => l.level !== 'data');

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>Modem Debug Console</Title>
        <Group>
          <SegmentedControl
            value={mode}
            onChange={v => setMode(v as 'stream' | 'log')}
            data={[{ label: 'Stream', value: 'stream' }, { label: 'Log', value: 'log' }]}
            size="xs"
          />
          <Badge color={connected ? 'green' : 'red'} variant="dot">
            {connected ? 'SSE Connected' : 'Disconnected'}
          </Badge>
          {mode === 'stream' && (
            <Switch label="Raw data" checked={showData} onChange={e => setShowData(e.currentTarget.checked)} />
          )}
          <Switch label="Pause" checked={paused} onChange={e => setPaused(e.currentTarget.checked)} />
          {mode === 'log' && (
            <Button size="xs" variant="light" loading={loadingLog} onClick={fetchLogHistory}>Refresh</Button>
          )}
          <Button size="xs" variant="light" color="orange" loading={restarting} onClick={restartModem}>Reinitialize Modem</Button>
          {mode === 'stream' && (
            <Button size="xs" variant="light" color="red" onClick={() => setStreamLogs([])}>Clear</Button>
          )}
        </Group>
      </Group>

      {/* Log output */}
      <Card shadow="sm" radius="md" withBorder p={0}>
        <ScrollArea h={480} viewportRef={viewport}>
          <Code block style={{ background: 'transparent', fontSize: 12, padding: '12px 16px', fontFamily: 'monospace' }}>
            {filtered.length === 0 && (
              <Text c="dimmed" size="xs">
                {mode === 'log' ? (loadingLog ? 'Loading log history...' : 'No log entries found.') : 'Waiting for modem activity...'}
              </Text>
            )}
            {filtered.map((entry, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 2, lineHeight: '1.5' }}>
                <span style={{ color: '#666', flexShrink: 0 }}>
                  {new Date(entry.ts).toLocaleTimeString()}
                </span>
                <Badge color={levelColor[entry.level]} size="xs" variant="light" style={{ flexShrink: 0, alignSelf: 'center' }}>
                  {entry.level}
                </Badge>
                <span style={{ wordBreak: 'break-all' }}>{entry.msg}</span>
              </div>
            ))}
          </Code>
        </ScrollArea>
      </Card>

      {/* Command input */}
      <Card shadow="sm" radius="md" withBorder>
        <Stack gap="sm">
          <Text size="sm" fw={500}>Send AT Command</Text>
          <Group gap="xs">
            <TextInput
              placeholder="e.g. ATI, ATZ, AT+VCID=1"
              value={command}
              onChange={e => setCommand(e.currentTarget.value)}
              onKeyDown={onKeyDown}
              style={{ flex: 1, fontFamily: 'monospace' }}
              disabled={sending}
              rightSection={
                <ActionIcon onClick={() => sendCommand(command)} loading={sending} variant="filled">
                  ↵
                </ActionIcon>
              }
            />
          </Group>
          <Group gap="xs">
            {COMMON_COMMANDS.map(cmd => (
              <Button
                key={cmd}
                size="xs"
                variant="default"
                style={{ fontFamily: 'monospace' }}
                onClick={() => sendCommand(cmd)}
                disabled={sending}
              >
                {cmd}
              </Button>
            ))}
          </Group>
          <Text size="xs" c="dimmed">↑ ↓ arrow keys for command history · Enter to send</Text>
        </Stack>
      </Card>
    </Stack>
  );
}
