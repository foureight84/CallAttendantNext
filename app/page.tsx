'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useRef } from 'react';
import { Card, Text, Title, Table, Badge, Stack, Tabs, UnstyledButton, SimpleGrid, Box, Group } from '@mantine/core';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { IconRecordMail } from '@tabler/icons-react';
import { apiClient } from '@/lib/api-client';
import { VoicemailModal } from '@/components/VoicemailModal';
import type { CallLog, ListEntry, Message } from '@/lib/contract';

interface Stats { total: number; blocked: number; permitted: number; screened: number }
type TrendRow = { date: string; total: number; blocked: number; permitted: number };
type TopCaller = { number: string; name: string | null; count: number };

function ActionBadge({ action }: { action: string | null }) {
  const colorMap: Record<string, string> = { Permitted: 'green', Blocked: 'red', Screened: 'yellow' };
  return <Badge color={colorMap[action ?? ''] ?? 'gray'}>{action ?? 'Unknown'}</Badge>;
}

function resolveCallerName(
  number: string | null,
  callerIdName: string | null,
  whitelist: Map<string, string | null>,
  blacklist: Map<string, string | null>,
): string {
  if (number) {
    if (whitelist.has(number)) return whitelist.get(number) || callerIdName || 'Unknown';
    if (blacklist.has(number)) return blacklist.get(number) || callerIdName || 'Unknown';
  }
  return callerIdName ?? '—';
}

function formatLabel(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  if (days <= 7) return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CallsChart({ data, days, mounted }: { data: TrendRow[]; days: number; mounted: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setChartWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  const chartData = data.map(r => ({
    date: formatLabel(r.date, days),
    Total: r.total,
    Blocked: r.blocked,
    Permitted: r.permitted,
  }));

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {chartWidth > 0 && (
        <BarChart width={chartWidth} height={300} data={chartData} style={{ fontFamily: 'inherit', fontSize: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Legend />
          <Bar dataKey="Total"     fill="#228be6" radius={[3,3,0,0]} />
          <Bar dataKey="Blocked"   fill="#fa5252" radius={[3,3,0,0]} />
          <Bar dataKey="Permitted" fill="#40c057" radius={[3,3,0,0]} />
        </BarChart>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ total: 0, blocked: 0, permitted: 0, screened: 0 });
  const [unplayed, setUnplayed] = useState(0);
  const [recentCalls, setRecentCalls] = useState<CallLog[]>([]);
  const [whitelist, setWhitelist] = useState<Map<string, string | null>>(new Map());
  const [blacklist, setBlacklist] = useState<Map<string, string | null>>(new Map());
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState('weekly');
  const [voicemailMap, setVoicemailMap] = useState<Map<number, Message>>(new Map());
  const [voicemailModal, setVoicemailModal] = useState<{ message: Message; call: CallLog } | null>(null);
  const [weeklyTrend, setWeeklyTrend]   = useState<TrendRow[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<TrendRow[]>([]);
  const [topCallers, setTopCallers]     = useState<TopCaller[]>([]);
  const [topBlocked, setTopBlocked]     = useState<TopCaller[]>([]);

  useEffect(() => {
    const rafId = requestAnimationFrame(() => setMounted(true));
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

    apiClient.calls.list({ limit: 10, offset: 0 }).then(data => {
      setRecentCalls(data.rows ?? []);
    });

    apiClient.calls.list({ limit: 500, offset: 0, startDate: todayStart, endDate: todayEnd }).then(data => {
      const rows = data.rows ?? [];
      setStats({
        total:     data.total ?? 0,
        blocked:   rows.filter(r => r.action === 'Blocked').length,
        permitted: rows.filter(r => r.action === 'Permitted').length,
        screened:  rows.filter(r => r.action === 'Screened').length,
      });
    });

    apiClient.messages.unread().then(d => setUnplayed(d.count)).catch(() => {});
    apiClient.messages.list({ limit: 50 }).then(d => {
      setVoicemailMap(new Map(
        d.messages
          .filter((m): m is Message & { callLogId: number } => m.callLogId !== null)
          .map(m => [m.callLogId, m])
      ));
    }).catch(() => {});

    const tzOffset = -new Date().getTimezoneOffset();
    apiClient.calls.trend(7, tzOffset).then(setWeeklyTrend).catch(() => {});
    apiClient.calls.trend(30, tzOffset).then(setMonthlyTrend).catch(() => {});
    apiClient.calls.top().then(d => { setTopCallers(d.callers); setTopBlocked(d.blocked); }).catch(() => {});

    Promise.all([
      apiClient.whitelist.list({ limit: 10000 }),
      apiClient.blacklist.list({ limit: 10000 }),
    ]).then(([wl, bl]) => {
      setWhitelist(new Map(wl.rows.map((e: ListEntry) => [e.phoneNo, e.name])));
      setBlacklist(new Map(bl.rows.map((e: ListEntry) => [e.phoneNo, e.name])));
    });

    return () => cancelAnimationFrame(rafId);
  }, []);

  const handleVoicemailDelete = (messageId: number) => {
    setVoicemailMap(prev => {
      const next = new Map(prev);
      for (const [callLogId, msg] of next) {
        if (msg.messageId === messageId) { next.delete(callLogId); break; }
      }
      return next;
    });
    setUnplayed(c => Math.max(0, c - 1));
  };

  const statCards = [
    { label: "Today's Calls", value: stats.total,  color: 'blue' },
    { label: 'Blocked',       value: stats.blocked, color: 'red' },
    { label: 'Permitted',     value: stats.permitted, color: 'green' },
    { label: 'New Voicemails',value: unplayed,      color: 'violet' },
  ];

  return (
    <Stack gap="lg">
      <Box
        style={{
          position: 'sticky',
          top: 'var(--app-shell-header-height, 0)',
          zIndex: 100,
          background: 'var(--mantine-color-body)',
          paddingTop: 8,
          paddingBottom: 8,
        }}
      >
        <Title order={2}>Dashboard</Title>
      </Box>

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
        {statCards.map((s) => (
          <Card key={s.label} shadow="sm" padding="lg" radius="md" withBorder>
            <Text size="sm" c="dimmed">{s.label}</Text>
            <Text size="2rem" fw={700} c={s.color}>{s.value}</Text>
          </Card>
        ))}
      </SimpleGrid>

      <Card shadow="sm" padding="lg" radius="md" withBorder>
        <Title order={4} mb="md">Recent Calls</Title>
        {/* Desktop */}
        <Box visibleFrom="sm" style={{ overflowX: 'auto' }}>
          <Table
            verticalSpacing={mounted ? 'xs' : undefined}
            fz={mounted ? 'sm' : undefined}
            striped={mounted ? 'odd' : undefined}
            stripedColor={mounted ? 'rgba(128,128,128,0.07)' : undefined}
            highlightOnHover={mounted}
            highlightOnHoverColor={mounted ? 'rgba(128,128,128,0.03)' : undefined}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Date</Table.Th>
                <Table.Th>Time</Table.Th>
                <Table.Th>Name</Table.Th>
                <Table.Th>Number</Table.Th>
                <Table.Th>Action</Table.Th>
                <Table.Th>Reason</Table.Th>
                <Table.Th></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {recentCalls.map((call) => {
                const voicemail = voicemailMap.get(call.callLogId);
                return (
                  <Table.Tr key={call.callLogId}>
                    <Table.Td>{call.date}</Table.Td>
                    <Table.Td>{call.time}</Table.Td>
                    <Table.Td>{resolveCallerName(call.number, call.name, whitelist, blacklist)}</Table.Td>
                    <Table.Td>{call.number ?? '—'}</Table.Td>
                    <Table.Td><ActionBadge action={call.action} /></Table.Td>
                    <Table.Td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{call.reason ?? '—'}</Table.Td>
                    <Table.Td>
                      {voicemail && (
                        <UnstyledButton onClick={() => setVoicemailModal({ message: voicemail, call })}>
                          <IconRecordMail
                            size={26}
                            stroke={1.5}
                            color={voicemail.played === 0
                              ? 'var(--mantine-color-blue-6)'
                              : 'var(--mantine-color-dimmed)'}
                          />
                        </UnstyledButton>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
              {recentCalls.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7} style={{ textAlign: 'center' }}>No calls yet</Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Box>

        {/* Mobile */}
        <Box hiddenFrom="sm">
          <Stack gap="sm">
            {recentCalls.map((call) => {
              const voicemail = voicemailMap.get(call.callLogId);
              return (
                <Card key={call.callLogId} shadow="sm" padding="md" radius="md" withBorder>
                  <Group justify="space-between" align="flex-start" mb={4}>
                    <div>
                      <Text fw={600}>{resolveCallerName(call.number, call.name, whitelist, blacklist)}</Text>
                      <Text size="sm" c="dimmed">{call.number ?? '—'}</Text>
                    </div>
                    <ActionBadge action={call.action} />
                  </Group>
                  <Text size="xs" c="dimmed" mt={4}>{call.date} {call.time}</Text>
                  {call.reason && <Text size="sm" c="dimmed" mt={4}>{call.reason}</Text>}
                  <Group justify="space-between" align="center" mt="xs">
                    <div>
                      {voicemail && (
                        <UnstyledButton onClick={() => setVoicemailModal({ message: voicemail, call })}>
                          <IconRecordMail
                            size={26}
                            stroke={1.5}
                            color={voicemail.played === 0
                              ? 'var(--mantine-color-blue-6)'
                              : 'var(--mantine-color-dimmed)'}
                          />
                        </UnstyledButton>
                      )}
                    </div>
                  </Group>
                </Card>
              );
            })}
            {recentCalls.length === 0 && <Text c="dimmed" ta="center">No calls yet</Text>}
          </Stack>
        </Box>
      </Card>

      <Card shadow="sm" padding="lg" radius="md" withBorder>
        <Title order={4} mb="md">Calls Over Time</Title>
        <Tabs value={activeTab} onChange={v => setActiveTab(v ?? 'weekly')}>
          <Tabs.List mb="md">
            <Tabs.Tab value="weekly">Last 7 Days</Tabs.Tab>
            <Tabs.Tab value="monthly">Last 30 Days</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="weekly">
            {activeTab === 'weekly' && <CallsChart data={weeklyTrend} days={7} mounted={mounted} />}
          </Tabs.Panel>
          <Tabs.Panel value="monthly">
            {activeTab === 'monthly' && <CallsChart data={monthlyTrend} days={30} mounted={mounted} />}
          </Tabs.Panel>
        </Tabs>
      </Card>

      {mounted && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Title order={4} mb="md">Top 10 Callers</Title>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>#</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>Number</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>Name</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>Calls</th>
                </tr>
              </thead>
              <tbody>
                {topCallers.map((row, i) => (
                  <tr key={row.number} style={{ borderBottom: '1px solid rgba(128,128,128,0.08)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--mantine-color-dimmed)' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px' }}>{row.number}</td>
                    <td style={{ padding: '6px 8px' }}>{resolveCallerName(row.number, row.name, whitelist, blacklist)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>{row.count}</td>
                  </tr>
                ))}
                {topCallers.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: '12px 8px', textAlign: 'center', color: 'var(--mantine-color-dimmed)' }}>No data</td></tr>
                )}
              </tbody>
            </table>
          </Card>

          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Title order={4} mb="md">Top 10 Blocked Callers</Title>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>#</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>Number</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600 }}>Name</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600 }}>Blocked</th>
                </tr>
              </thead>
              <tbody>
                {topBlocked.map((row, i) => (
                  <tr key={row.number} style={{ borderBottom: '1px solid rgba(128,128,128,0.08)' }}>
                    <td style={{ padding: '6px 8px', color: 'var(--mantine-color-dimmed)' }}>{i + 1}</td>
                    <td style={{ padding: '6px 8px' }}>{row.number}</td>
                    <td style={{ padding: '6px 8px' }}>{resolveCallerName(row.number, row.name, whitelist, blacklist)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: 'var(--mantine-color-red-6)' }}>{row.count}</td>
                  </tr>
                ))}
                {topBlocked.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: '12px 8px', textAlign: 'center', color: 'var(--mantine-color-dimmed)' }}>No data</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </SimpleGrid>
      )}

      <VoicemailModal
        opened={voicemailModal !== null}
        onClose={() => setVoicemailModal(null)}
        message={voicemailModal?.message ?? null}
        callerName={voicemailModal
          ? resolveCallerName(voicemailModal.call.number, voicemailModal.call.name, whitelist, blacklist)
          : ''}
        callerNumber={voicemailModal?.call.number ?? null}
        onDelete={handleVoicemailDelete}
      />
    </Stack>
  );
}
