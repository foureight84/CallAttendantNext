'use client';

import { useEffect, useState, useCallback } from 'react';
import { Stack, Title, Card, Group, Text, Button, Badge, Loader, Alert, ThemeIcon, Box, Divider } from '@mantine/core';
import { IconCheck, IconX, IconClock, IconRefresh, IconPlayerPlay, IconAlertCircle, IconStethoscope } from '@tabler/icons-react';
import type { DiagnosticState, DiagnosticTest, TestStatus } from '@/lib/diagnostic';

function statusColor(status: TestStatus): string {
  switch (status) {
    case 'pass': return 'green';
    case 'fail': return 'red';
    case 'running': return 'blue';
    default: return 'gray';
  }
}

function StatusIcon({ status }: { status: TestStatus }) {
  switch (status) {
    case 'pass':    return <ThemeIcon color="green" size="sm" radius="xl"><IconCheck size={12} /></ThemeIcon>;
    case 'fail':    return <ThemeIcon color="red"   size="sm" radius="xl"><IconX size={12} /></ThemeIcon>;
    case 'running': return <Loader size="xs" color="blue" />;
    default:        return <ThemeIcon color="gray"  size="sm" radius="xl" variant="light"><IconClock size={12} /></ThemeIcon>;
  }
}

function TestRow({ test, isActive }: { test: DiagnosticTest; isActive: boolean }) {
  return (
    <Box
      p="sm"
      style={{
        borderRadius: 8,
        border: `1px solid var(--mantine-color-${isActive ? 'blue' : 'default'}-${isActive ? '4' : 'border'})`,
        background: isActive ? 'var(--mantine-color-blue-light)' : undefined,
        opacity: test.status === 'pending' ? 0.5 : 1,
      }}
    >
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <StatusIcon status={test.status} />
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text fw={500} size="sm">{test.name}</Text>
            <Text size="xs" c="dimmed">{test.description}</Text>
            {test.status === 'running' && test.instruction && (
              <Text size="xs" c="blue" fw={500} mt={4}>{test.instruction}</Text>
            )}
            {test.message && test.status !== 'running' && (
              <Text size="xs" c={test.status === 'fail' ? 'red' : 'green'} mt={2}>{test.message}</Text>
            )}
          </Box>
        </Group>
        <Badge color={statusColor(test.status)} variant="light" size="sm" style={{ flexShrink: 0 }}>
          {test.status}
        </Badge>
      </Group>
    </Box>
  );
}

function Summary({ tests }: { tests: DiagnosticTest[] }) {
  const passed = tests.filter(t => t.status === 'pass').length;
  const failed = tests.filter(t => t.status === 'fail').length;
  const allDone = tests.every(t => t.status === 'pass' || t.status === 'fail');
  if (!allDone) return null;

  const allPassed = failed === 0;
  return (
    <Alert
      color={allPassed ? 'green' : 'red'}
      icon={allPassed ? <IconCheck size={16} /> : <IconAlertCircle size={16} />}
      title={allPassed ? 'All tests passed' : `${failed} test${failed === 1 ? '' : 's'} failed`}
    >
      {allPassed
        ? 'Your call attendant system is working correctly end-to-end.'
        : `${passed} of ${tests.length} tests passed. Review the failures above and check your modem connection, TTS setup, and screening configuration.`}
    </Alert>
  );
}

export default function DiagnosticPage() {
  const [state, setState] = useState<DiagnosticState | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/diagnostic');
      if (res.ok) setState(await res.json() as DiagnosticState);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchState();

    const es = new EventSource('/api/events');
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as { type: string; payload?: DiagnosticState };
        if (msg.type === 'diagnostic-update' && msg.payload) {
          setState(msg.payload);
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => {};
    return () => es.close();
  }, [fetchState]);

  const handleStart = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/diagnostic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' }) });
      if (res.ok) setState(await res.json() as DiagnosticState);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/diagnostic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset' }) });
      if (res.ok) setState(await res.json() as DiagnosticState);
    } finally {
      setLoading(false);
    }
  };

  const isRunning = state?.sessionId != null && state.tests.some(t => t.status === 'running');
  const isStarted = state?.sessionId != null;

  const currentTest = state != null && state.currentTestIndex >= 0
    ? state.tests[state.currentTestIndex]
    : null;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Group gap="sm">
          <IconStethoscope size={24} stroke={1.5} />
          <div>
            <Title order={2}>Diagnostics</Title>
            <Text size="sm" c="dimmed">Interactive test suite — real phone calls required for most tests</Text>
          </div>
        </Group>
        <Group gap="sm">
          {isStarted && (
            <Button variant="subtle" size="sm" leftSection={<IconRefresh size={14} />} onClick={handleReset} loading={loading}>
              Reset
            </Button>
          )}
          {!isRunning && (
            <Button size="sm" leftSection={<IconPlayerPlay size={14} />} onClick={handleStart} loading={loading}>
              {isStarted ? 'Run Again' : 'Start Diagnostics'}
            </Button>
          )}
        </Group>
      </Group>

      {!isStarted && (
        <Alert color="blue" icon={<IconAlertCircle size={16} />} title="Before you start">
          This wizard will guide you through 9 tests that verify your call attendant system end-to-end.
          Tests 2–7 require one incoming call. Tests 8 and 9 each require one additional call.
          Your caller number will be temporarily added to the blocklist and whitelist during those tests, then removed automatically.
        </Alert>
      )}

      {state != null && (
        <Card withBorder>
          <Stack gap="xs">
            {state.tests.map((test, i) => (
              <TestRow
                key={test.id}
                test={test}
                isActive={state.currentTestIndex === i && test.status === 'running'}
              />
            ))}
          </Stack>

          {state.detectedNumber && (
            <>
              <Divider my="sm" />
              <Group gap="xs">
                <Text size="xs" c="dimmed">Detected caller:</Text>
                <Badge size="xs" variant="outline">{state.detectedNumber}</Badge>
                {state.detectedName && <Badge size="xs" variant="outline" color="gray">{state.detectedName}</Badge>}
              </Group>
            </>
          )}

          {isRunning && currentTest?.instruction && (
            <>
              <Divider my="sm" />
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="sm" fw={500}>{currentTest.instruction}</Text>
              </Group>
            </>
          )}
        </Card>
      )}

      {state != null && <Summary tests={state.tests} />}
    </Stack>
  );
}
