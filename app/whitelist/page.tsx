'use client';

import { useState, useEffect } from 'react';
import { Stack, Title, Table, Button, Group, Text, TextInput, Select, Pagination, Card, Box } from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { AddToListModal } from '@/components/AddToListModal';
import { apiClient } from '@/lib/api-client';
import type { ListEntry } from '@/lib/contract';

const PAGE_SIZE_OPTIONS = ['10', '20', '50', '100'];

export default function WhitelistPage() {
  const [rows, setRows]           = useState<ListEntry[]>([]);
  const [total, setTotal]         = useState(0);
  const [search, setSearch]       = useState('');
  const [debouncedSearch]         = useDebouncedValue(search, 300);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate]     = useState('');
  const [page, setPage]           = useState(1);
  const [pageSize, setPageSize]   = useState(20);
  const [opened, { open, close }] = useDisclosure(false);
  const [editEntry, setEditEntry] = useState<ListEntry | null>(null);

  const load = () =>
    apiClient.whitelist.list({ limit: pageSize, offset: (page - 1) * pageSize, search: debouncedSearch || undefined, startDate: startDate ? new Date(`${startDate}T00:00:00`).toISOString() : undefined, endDate: endDate ? new Date(`${endDate}T23:59:59.999`).toISOString() : undefined })
      .then(d => { setRows(d.rows); setTotal(d.total); });

  useEffect(() => {
    load();
  }, [page, pageSize, debouncedSearch, startDate, endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (phoneNo: string) => {
    await apiClient.whitelist.remove({ phoneNo });
    load();
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>Phonebook</Title>
        <Button onClick={open}>Add Number</Button>
      </Group>

      <Text c="dimmed" size="sm">
        Numbers in the phonebook are always permitted without screening.
      </Text>

      <Card shadow="sm" padding="md" radius="md" withBorder>
        <Group gap="sm" align="flex-end" wrap="wrap">
          <TextInput
            label="Search"
            placeholder="Name or number..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
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

      <Box visibleFrom="sm">
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
      </Box>

      {/* Mobile cards */}
      <Box hiddenFrom="sm">
        <Stack gap="sm">
          {rows.map((row) => (
            <Card key={row.phoneNo} shadow="sm" padding="md" radius="md" withBorder>
              <Text fw={600}>{row.phoneNo}</Text>
              <Text size="sm" c="dimmed" mb={4}>{row.name ?? '—'}</Text>
              {row.reason && <Text size="sm" mb={4}>{row.reason}</Text>}
              <Text size="xs" c="dimmed" mb="xs">Added: {row.systemDateTime ? new Date(row.systemDateTime).toLocaleDateString() : '—'}</Text>
              <Group justify="flex-end" gap={6} mt="xs">
                <Button size="xs" variant="light" onClick={() => setEditEntry(row)}>Edit</Button>
                <Button size="xs" variant="light" color="red" onClick={() => remove(row.phoneNo)}>Remove</Button>
              </Group>
            </Card>
          ))}
          {rows.length === 0 && <Text c="dimmed" ta="center">No entries</Text>}
        </Stack>
      </Box>

      {totalPages > 1 && (
        <Group justify="center">
          <Pagination total={totalPages} value={page} onChange={setPage} withEdges />
        </Group>
      )}

      <AddToListModal list="whitelist" opened={opened} onClose={close} onSuccess={load} />
      <AddToListModal
        list="whitelist"
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
