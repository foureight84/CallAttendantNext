'use client';

import { useState, useEffect } from 'react';
import { Stack, Title, Table, Button, Group, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { AddToListModal } from '@/components/AddToListModal';
import { apiClient } from '@/lib/api-client';
import type { ListEntry } from '@/lib/contract';

export default function WhitelistPage() {
  const [rows, setRows] = useState<ListEntry[]>([]);
  const [opened, { open, close }] = useDisclosure(false);
  const [editEntry, setEditEntry] = useState<ListEntry | null>(null);

  const load = () => apiClient.whitelist.list().then(setRows);
  useEffect(() => { load(); }, []);

  const remove = async (phoneNo: string) => {
    await apiClient.whitelist.remove({ phoneNo });
    load();
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Title order={2}>Phonebook</Title>
        <Button onClick={open}>Add Number</Button>
      </Group>

      <Text c="dimmed" size="sm">
        Numbers in the phonebook are always permitted without screening.
      </Text>

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
