'use client';

import { useState, useEffect } from 'react';
import { Stack, Title, Table, Button, Group, Text, TextInput, Select, Pagination, Card } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useDisclosure } from '@mantine/hooks';
import { AddToListModal } from '@/components/AddToListModal';
import { apiClient } from '@/lib/api-client';
import type { ListEntry, AppSettings } from '@/lib/contract';

const PAGE_SIZE_OPTIONS = ['10', '20', '50', '100'];

function blocklistActionDescription(settings: AppSettings | null): string {
  if (!settings) return '';
  switch (settings.blocklistAction) {
    case 1: return 'Blocked callers are hung up on silently with no message.';
    case 2: return 'Blocked callers hear a block message, then are hung up on.';
    case 3: {
      const n = settings.ringsBeforeVmBlocklist;
      return `Blocked callers ring ${n} time${n === 1 ? '' : 's'} before being sent to voicemail.`;
    }
    default: return '';
  }
}

export default function BlacklistPage() {
  const [rows, setRows]       = useState<ListEntry[]>([]);
  const [total, setTotal]     = useState(0);
  const [search, setSearch]   = useState('');
  const [debouncedSearch]     = useDebouncedValue(search, 300);
  const [page, setPage]       = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [opened, { open, close }] = useDisclosure(false);
  const [editEntry, setEditEntry] = useState<ListEntry | null>(null);

  const load = () =>
    apiClient.blacklist.list({ limit: pageSize, offset: (page - 1) * pageSize, search: debouncedSearch || undefined })
      .then(d => { setRows(d.rows); setTotal(d.total); });

  useEffect(() => {
    load();
  }, [page, pageSize, debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    apiClient.settings.get().then(setSettings).catch(() => {});
  }, []);

  const remove = async (phoneNo: string) => {
    await apiClient.blacklist.remove({ phoneNo });
    load();
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>Blocklist</Title>
        <Button color="red" onClick={open}>Add Number</Button>
      </Group>

      {settings && (
        <Text c="dimmed" size="sm">
          {blocklistActionDescription(settings)}{' '}
          <Text component="span" size="sm" c="dimmed">
            (Change in <Text component="a" href="/settings" size="sm">Settings → Blocklist</Text>)
          </Text>
        </Text>
      )}

      <Card shadow="sm" padding="md" radius="md" withBorder>
        <TextInput
          label="Search"
          placeholder="Name or number..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
        />
      </Card>

      <Group justify="space-between" align="center">
        <Text c="dimmed" size="sm">{total} entries</Text>
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

      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Phone Number</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Reason</Table.Th>
            <Table.Th>Added</Table.Th>
            <Table.Th></Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((row) => (
            <Table.Tr key={row.phoneNo}>
              <Table.Td>{row.phoneNo}</Table.Td>
              <Table.Td>{row.name ?? '—'}</Table.Td>
              <Table.Td>{row.reason ?? '—'}</Table.Td>
              <Table.Td>{row.systemDateTime ? new Date(row.systemDateTime).toLocaleDateString() : '—'}</Table.Td>
              <Table.Td>
                <Group gap={6} wrap="nowrap">
                  <Button size="xs" variant="light" onClick={() => setEditEntry(row)}>Edit</Button>
                  <Button size="xs" variant="light" color="red" onClick={() => remove(row.phoneNo)}>Remove</Button>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
          {rows.length === 0 && (
            <Table.Tr><Table.Td colSpan={5} style={{ textAlign: 'center' }}>No entries</Table.Td></Table.Tr>
          )}
        </Table.Tbody>
      </Table>

      {totalPages > 1 && (
        <Group justify="center">
          <Pagination total={totalPages} value={page} onChange={setPage} withEdges />
        </Group>
      )}

      <AddToListModal list="blacklist" opened={opened} onClose={close} onSuccess={load} />
      <AddToListModal
        list="blacklist"
        editMode
        opened={editEntry !== null}
        onClose={() => setEditEntry(null)}
        initialValues={{ phoneNo: editEntry?.phoneNo, name: editEntry?.name ?? '', reason: editEntry?.reason ?? '' }}
        originalPhoneNo={editEntry?.phoneNo}
        onSuccess={load}
      />
    </Stack>
  );
}
