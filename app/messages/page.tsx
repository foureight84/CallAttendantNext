'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Stack, Title, Card, Group, Text, Badge, Button, Select,
  Pagination, TextInput, Checkbox, Box,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { AudioPlayer } from '@/components/AudioPlayer';
import { apiClient } from '@/lib/api-client';
import type { Message, ListEntry } from '@/lib/contract';

const PAGE_SIZE_OPTIONS = ['10', '20', '50', '100'];

function resolveName(msg: Message, whitelist: ListEntry[]): string {
  if (msg.number) {
    const entry = whitelist.find(w => w.phoneNo === msg.number);
    if (entry?.name) return entry.name;
  }
  return msg.name ?? '—';
}

export default function MessagesPage() {
  const [messages, setMessages]     = useState<Message[]>([]);
  const [whitelist, setWhitelist]   = useState<ListEntry[]>([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [pageSize, setPageSize]     = useState(20);
  const [search, setSearch]         = useState('');
  const [debouncedSearch]           = useDebouncedValue(search, 300);
  const [startDate, setStartDate]   = useState('');
  const [endDate, setEndDate]       = useState('');
  const [unplayedOnly, setUnplayedOnly] = useState(false);

  useEffect(() => {
    apiClient.whitelist.list({ limit: 10000 }).then(d => setWhitelist(d.rows));
  }, []);

  const load = useCallback(() => {
    apiClient.messages.list({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      search: debouncedSearch || undefined,
      startDate: startDate ? new Date(`${startDate}T00:00:00`).toISOString() : undefined,
      endDate:   endDate   ? new Date(`${endDate}T23:59:59.999`).toISOString() : undefined,
      unplayedOnly: unplayedOnly || undefined,
    }).then(data => { setMessages(data.messages); setTotal(data.total); });
  }, [page, pageSize, debouncedSearch, startDate, endDate, unplayedOnly]);

  useEffect(() => { load(); }, [load]);

  // Reset to page 1 when filters change
  const applyFilters = () => { setPage(1); };

  const markPlayed = async (messageId: number) => {
    setMessages(prev => prev.map(m => m.messageId === messageId ? { ...m, played: 1 } : m));
    await apiClient.messages.patch({ messageId, played: true });
  };

  const markUnplayed = async (messageId: number) => {
    setMessages(prev => prev.map(m => m.messageId === messageId ? { ...m, played: 0 } : m));
    await apiClient.messages.patch({ messageId, played: false });
  };

  const deleteMessage = async (messageId: number) => {
    await apiClient.messages.delete({ messageId });
    load();
  };

  const download = (msg: Message) => {
    if (!msg.filename) return;
    const params = new URLSearchParams({ filename: msg.filename });
    if (msg.number) params.set('number', msg.number);
    window.location.href = `/api/messages/download?${params}`;
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
        <Title order={2}>Voicemails</Title>
      </Box>

      <Card shadow="sm" padding="md" radius="md" withBorder>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <TextInput
            label="Search"
            placeholder="Name or number..."
            value={search}
            onChange={e => { setSearch(e.currentTarget.value); setPage(1); }}
            style={{ flex: 1, minWidth: 160 }}
          />
          <TextInput
            label="From date"
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.currentTarget.value)}
          />
          <TextInput
            label="To date"
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.currentTarget.value)}
          />
          <Checkbox
            label="New only"
            checked={unplayedOnly}
            onChange={e => { setUnplayedOnly(e.currentTarget.checked); setPage(1); }}
            style={{ alignSelf: 'center', marginTop: 20 }}
          />
          <Button onClick={applyFilters}>Apply</Button>
          <Button variant="subtle" onClick={() => { setSearch(''); setStartDate(''); setEndDate(''); setUnplayedOnly(false); setPage(1); }}>
            Clear
          </Button>
        </Group>
      </Card>

      <Group justify="space-between" align="center">
        <Text size="sm" c="dimmed">
          {total} voicemail{total !== 1 ? 's' : ''}
          {messages.filter(m => !m.played).length > 0 && (
            <> &middot; <Text span c="blue" fw={600}>{messages.filter(m => !m.played).length} new</Text></>
          )}
        </Text>
        <Group gap="xs" align="center">
          <Text size="sm" c="dimmed">Per page:</Text>
          <Select
            data={PAGE_SIZE_OPTIONS}
            value={String(pageSize)}
            onChange={v => { setPageSize(Number(v)); setPage(1); }}
            w={80}
            size="xs"
          />
        </Group>
      </Group>

      {messages.length === 0 && <Text c="dimmed">No voicemails found.</Text>}

      {messages.map((msg) => (
        <Card key={msg.messageId} shadow="sm" padding="lg" radius="md" withBorder>
          <Group justify="space-between" mb="sm" align="flex-start" wrap="nowrap">
            <Group gap="xs">
              <Text fw={600}>{resolveName(msg, whitelist)}</Text>
              <Text c="dimmed">{msg.number ?? ''}</Text>
              {!msg.played && <Badge color="blue" size="sm">New</Badge>}
            </Group>
            {/* Desktop: date + buttons on one row */}
            <Box visibleFrom="sm">
              <Group gap="xs" wrap="wrap" justify="flex-end">
                <Text size="sm" c="dimmed">
                  {msg.dateTime ? new Date(msg.dateTime).toLocaleString() : ''}
                </Text>
                {!msg.played ? (
                  <Button size="xs" variant="light" onClick={() => markPlayed(msg.messageId)}>Mark Played</Button>
                ) : (
                  <Button size="xs" variant="subtle" color="gray" onClick={() => markUnplayed(msg.messageId)}>Mark as New</Button>
                )}
                {msg.filename && (
                  <Button size="xs" variant="light" color="teal" onClick={() => download(msg)}>Download</Button>
                )}
                <Button size="xs" variant="light" color="red" onClick={() => deleteMessage(msg.messageId)}>Delete</Button>
              </Group>
            </Box>
          </Group>
          {/* Mobile: date on its own line, buttons on the next */}
          <Box hiddenFrom="sm" mb="sm">
            <Text size="sm" c="dimmed" mb={6}>
              {msg.dateTime ? new Date(msg.dateTime).toLocaleString() : ''}
            </Text>
            <Group gap="xs">
              {!msg.played ? (
                <Button size="xs" variant="light" onClick={() => markPlayed(msg.messageId)}>Mark Played</Button>
              ) : (
                <Button size="xs" variant="subtle" color="gray" onClick={() => markUnplayed(msg.messageId)}>Mark as New</Button>
              )}
              {msg.filename && (
                <Button size="xs" variant="light" color="teal" onClick={() => download(msg)}>Download</Button>
              )}
              <Button size="xs" variant="light" color="red" onClick={() => deleteMessage(msg.messageId)}>Delete</Button>
            </Group>
          </Box>
          {msg.filename && (
            <AudioPlayer
              filename={msg.filename}
              onPlay={() => { if (!msg.played) markPlayed(msg.messageId); }}
            />
          )}
        </Card>
      ))}

      {totalPages > 1 && (
        <Group justify="center">
          <Pagination total={totalPages} value={page} onChange={setPage} />
        </Group>
      )}
    </Stack>
  );
}
