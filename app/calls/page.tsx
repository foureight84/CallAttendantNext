'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Table, Badge, Title, Stack, TextInput, Group, Pagination, Text, Button, Select, Card, UnstyledButton, Menu, ActionIcon, Box, Tooltip } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconRecordMail, IconDots, IconAddressBook, IconBan, IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { AddToListModal } from '@/components/AddToListModal';
import { VoicemailModal } from '@/components/VoicemailModal';
import { apiClient } from '@/lib/api-client';
import type { CallLog, ListEntry, Message } from '@/lib/contract';

function ActionBadge({ action }: { action: string | null }) {
  const colorMap: Record<string, string> = { Permitted: 'green', Blocked: 'red', Screened: 'yellow' };
  return <Badge color={colorMap[action ?? ''] ?? 'gray'}>{action ?? 'Unknown'}</Badge>;
}

function hasIpqsMeta(call: CallLog): boolean {
  return !!(call.lineType || call.carrier || call.city || call.region || call.country || call.fraudScore != null || call.riskFlags);
}

function FraudScoreBadge({ score }: { score: number }) {
  const color = score >= 90 ? 'red' : score >= 75 ? 'orange' : score >= 50 ? 'yellow' : 'green';
  return <Badge size="sm" color={color} variant="light">fraud score: {score}</Badge>;
}

function CallerMeta({ call }: { call: CallLog }) {
  const location = [call.city, call.region, call.country].filter(Boolean).join(', ');
  const flags = call.riskFlags ? call.riskFlags.split(',').filter(Boolean) : [];
  return (
    <Group gap="xs" wrap="wrap">
      {call.lineType && <Badge size="sm" variant="outline" color="blue">{call.lineType}</Badge>}
      {call.carrier && <Text size="xs" c="dimmed">{call.carrier}</Text>}
      {location && <Text size="xs" c="dimmed">{location}</Text>}
      {call.fraudScore != null && <FraudScoreBadge score={call.fraudScore} />}
      {flags.map(f => {
        const label = f.replace(/_/g, ' ');
        const tooltip = f === 'do_not_call'
          ? 'Registered on the FCC Do Not Call list — intended for telemarketers, does not indicate spam'
          : undefined;
        const badge = <Badge key={f} size="sm" color={f === 'do_not_call' ? 'gray' : 'red'} variant="light">{label}</Badge>;
        return tooltip ? <Tooltip key={f} label={tooltip} multiline maw={260}>{badge}</Tooltip> : badge;
      })}
    </Group>
  );
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

const PAGE_SIZE_OPTIONS = ['10', '20', '50', '100'];

export default function CallsPage() {
  const [rows, setRows] = useState<CallLog[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [whitelist, setWhitelist] = useState<Map<string, string | null>>(new Map());
  const [blacklist, setBlacklist] = useState<Map<string, string | null>>(new Map());
  const [modal, setModal] = useState<{ list: 'whitelist' | 'blacklist'; call: CallLog } | null>(null);
  const [voicemailMap, setVoicemailMap] = useState<Map<number, Message>>(new Map());
  const [voicemailModal, setVoicemailModal] = useState<{ message: Message; call: CallLog } | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (id: number) => setExpandedRows(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const loadLists = useCallback(() => {
    Promise.all([
      apiClient.whitelist.list({ limit: 10000 }),
      apiClient.blacklist.list({ limit: 10000 }),
    ]).then(([wl, bl]) => {
      setWhitelist(new Map(wl.rows.map((e: ListEntry) => [e.phoneNo, e.name])));
      setBlacklist(new Map(bl.rows.map((e: ListEntry) => [e.phoneNo, e.name])));
    });
  }, []);

  useEffect(() => {
    loadLists();
    apiClient.messages.list({ limit: 200 }).then(d => {
      setVoicemailMap(new Map(
        d.messages
          .filter((m): m is Message & { callLogId: number } => m.callLogId !== null)
          .map(m => [m.callLogId, m])
      ));
    }).catch(() => {});
  }, [loadLists]);

  useEffect(() => {
    apiClient.calls.list({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      search: debouncedSearch || undefined,
      startDate: startDate ? new Date(`${startDate}T00:00:00`).toISOString() : undefined,
      endDate:   endDate   ? new Date(`${endDate}T23:59:59.999`).toISOString() : undefined,
    }).then(data => {
      setRows(data.rows);
      setTotal(data.total);
    });
  }, [page, pageSize, debouncedSearch, startDate, endDate]);

  const handleVoicemailDelete = (messageId: number) => {
    setVoicemailMap(prev => {
      const next = new Map(prev);
      for (const [callLogId, msg] of next) {
        if (msg.messageId === messageId) { next.delete(callLogId); break; }
      }
      return next;
    });
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
        <Title order={2}>Call Log</Title>
      </Box>
      <Card shadow="sm" padding="md" radius="md" withBorder>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <TextInput
            label="Search"
            placeholder="Name or number..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ flex: 1, minWidth: 160 }}
          />
          <TextInput
            label="From date"
            type="date"
            value={startDate}
            onChange={e => { setStartDate(e.currentTarget.value); setPage(1); }}
          />
          <TextInput
            label="To date"
            type="date"
            value={endDate}
            onChange={e => { setEndDate(e.currentTarget.value); setPage(1); }}
          />
          <Button variant="subtle" onClick={() => { setStartDate(''); setEndDate(''); setPage(1); }}>
            Clear dates
          </Button>
        </Group>
      </Card>

      <Group justify="space-between" align="center">
        <Text c="dimmed" size="sm">{total} calls</Text>
        <Group gap="xs" align="center">
          <Text size="sm" c="dimmed">Per page:</Text>
          <Select
            data={PAGE_SIZE_OPTIONS}
            value={String(pageSize)}
            onChange={v => { if (v) { setPageSize(Number(v)); setPage(1); } }}
            w={80}
            size="xs"
            allowDeselect={false}
          />
        </Group>
      </Group>

      <Box visibleFrom="sm">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>ID</Table.Th>
              <Table.Th>Date</Table.Th>
              <Table.Th>Time</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Number</Table.Th>
              <Table.Th visibleFrom="sm">Action</Table.Th>
              <Table.Th visibleFrom="sm">Reason</Table.Th>
              <Table.Th></Table.Th>
              <Table.Th></Table.Th>
              <Table.Th></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((call) => {
              const inList = !!call.number && (whitelist.has(call.number) || blacklist.has(call.number));
              const displayName = resolveCallerName(call.number, call.name, whitelist, blacklist);
              const voicemail = voicemailMap.get(call.callLogId);
              const hasMeta = hasIpqsMeta(call);
              const expanded = expandedRows.has(call.callLogId);
              return (
                <React.Fragment key={call.callLogId}>
                  <Table.Tr>
                    <Table.Td>{call.callLogId}</Table.Td>
                    <Table.Td>{call.date ?? '—'}</Table.Td>
                    <Table.Td>{call.time ?? '—'}</Table.Td>
                    <Table.Td>{displayName}</Table.Td>
                    <Table.Td>{call.number ?? '—'}</Table.Td>
                    <Table.Td visibleFrom="sm"><ActionBadge action={call.action} /></Table.Td>
                    <Table.Td visibleFrom="sm" style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {call.reason ?? '—'}
                    </Table.Td>
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
                    <Table.Td>
                      {call.number && !inList && (
                        <>
                          <Box visibleFrom="sm">
                            <Group gap={6} wrap="nowrap">
                              <Button size="xs" variant="light" color="green" onClick={() => setModal({ list: 'whitelist', call })}>
                                Add to Phonebook
                              </Button>
                              <Button size="xs" variant="light" color="red" onClick={() => setModal({ list: 'blacklist', call })}>
                                Block
                              </Button>
                            </Group>
                          </Box>
                          <Box hiddenFrom="sm">
                            <Menu position="bottom-end" withinPortal>
                              <Menu.Target>
                                <ActionIcon variant="subtle" size="sm">
                                  <IconDots size={16} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Item leftSection={<IconAddressBook size={14} />} color="green" onClick={() => setModal({ list: 'whitelist', call })}>
                                  Add to Phonebook
                                </Menu.Item>
                                <Menu.Item leftSection={<IconBan size={14} />} color="red" onClick={() => setModal({ list: 'blacklist', call })}>
                                  Block
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                          </Box>
                        </>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {hasMeta && (
                        <Tooltip label={expanded ? 'Hide caller info' : 'Show caller info'} position="left">
                          <ActionIcon variant="subtle" size="sm" onClick={() => toggleRow(call.callLogId)}>
                            {expanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Table.Td>
                  </Table.Tr>
                  {hasMeta && expanded && (
                    <Table.Tr style={{ background: 'var(--mantine-color-default-hover)' }}>
                      <Table.Td colSpan={10} py={6} px="md">
                        <CallerMeta call={call} />
                      </Table.Td>
                    </Table.Tr>
                  )}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={10} style={{ textAlign: 'center' }}>No calls found</Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Box>

      {/* Mobile cards */}
      <Box hiddenFrom="sm">
        <Stack gap="sm">
          {rows.map((call) => {
            const inList = !!call.number && (whitelist.has(call.number) || blacklist.has(call.number));
            const displayName = resolveCallerName(call.number, call.name, whitelist, blacklist);
            const voicemail = voicemailMap.get(call.callLogId);
            return (
              <Card key={call.callLogId} shadow="sm" padding="md" radius="md" withBorder>
                <Group justify="space-between" align="flex-start" mb={4}>
                  <div>
                    <Text fw={600}>{displayName}</Text>
                    <Text size="sm" c="dimmed">{call.number ?? '—'}</Text>
                  </div>
                  <ActionBadge action={call.action} />
                </Group>
                <Text size="xs" c="dimmed" mb="xs">{call.date ?? '—'} {call.time ?? ''}</Text>
                {call.reason && (
                  <Text size="sm" c="dimmed" mb="xs">{call.reason}</Text>
                )}
                {hasIpqsMeta(call) && (
                  <Box mb="xs">
                    <CallerMeta call={call} />
                  </Box>
                )}
                <Group justify="space-between" align="center" mt="xs">
                  <div>
                    {voicemail && (
                      <UnstyledButton onClick={() => setVoicemailModal({ message: voicemail, call })}>
                        <IconRecordMail
                          size={26}
                          stroke={1.5}
                          color={voicemail.played === 0 ? 'var(--mantine-color-blue-6)' : 'var(--mantine-color-dimmed)'}
                        />
                      </UnstyledButton>
                    )}
                  </div>
                  {call.number && !inList && (
                    <Group gap="xs">
                      <Button size="xs" variant="light" color="green" onClick={() => setModal({ list: 'whitelist', call })}>
                        Add to Phonebook
                      </Button>
                      <Button size="xs" variant="light" color="red" onClick={() => setModal({ list: 'blacklist', call })}>
                        Block
                      </Button>
                    </Group>
                  )}
                </Group>
              </Card>
            );
          })}
          {rows.length === 0 && <Text c="dimmed" ta="center">No calls found</Text>}
        </Stack>
      </Box>

      {totalPages > 1 && (
        <Group justify="center">
          <Pagination total={totalPages} value={page} onChange={setPage} withEdges />
        </Group>
      )}

      <AddToListModal
        list={modal?.list ?? 'whitelist'}
        opened={modal !== null}
        onClose={() => setModal(null)}
        initialValues={{ phoneNo: modal?.call.number ?? '', name: modal?.call.name ?? '' }}
        onSuccess={loadLists}
      />

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
