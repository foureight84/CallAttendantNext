'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal, Group, Button, Text, Stack } from '@mantine/core';
import { IconDownload, IconTrash } from '@tabler/icons-react';
import { AudioPlayer } from '@/components/AudioPlayer';
import { apiClient } from '@/lib/api-client';
import type { Message } from '@/lib/contract';

interface VoicemailModalProps {
  opened: boolean;
  onClose: () => void;
  message: Message | null;
  callerName: string;
  callerNumber: string | null;
  onDelete: (messageId: number) => void;
}

export function VoicemailModal({ opened, onClose, message, callerName, callerNumber, onDelete }: VoicemailModalProps) {
  const markedRef = useRef<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (opened && message && message.played === 0 && markedRef.current !== message.messageId) {
      markedRef.current = message.messageId;
      apiClient.messages.patch({ messageId: message.messageId, played: true }).catch(() => {});
    }
    if (!opened) setConfirmDelete(false);
  }, [opened, message]);

  const handleDelete = async () => {
    if (!message) return;
    await apiClient.messages.delete({ messageId: message.messageId }).catch(() => {});
    onDelete(message.messageId);
    onClose();
  };

  const downloadUrl = message?.filename
    ? `/api/messages/download?filename=${encodeURIComponent(message.filename)}${callerNumber ? `&number=${encodeURIComponent(callerNumber)}` : ''}`
    : null;

  return (
    <Modal opened={opened} onClose={onClose} title="Voicemail" size="md">
      {message?.filename ? (
        <Stack gap="md">
          <div>
            <Text fw={500}>{callerName}</Text>
            {callerNumber && <Text size="sm" c="dimmed">{callerNumber}</Text>}
          </div>
          <AudioPlayer filename={message.filename} />
          {confirmDelete ? (
            <Group justify="flex-end" gap="sm" mt="xs">
              <Text size="sm" c="dimmed" style={{ flex: 1 }}>Delete this voicemail?</Text>
              <Button variant="default" size="xs" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button color="red" size="xs" onClick={handleDelete}>Delete</Button>
            </Group>
          ) : (
            <Group justify="space-between" mt="xs">
              <Button
                component="a"
                href={downloadUrl!}
                download
                variant="light"
                leftSection={<IconDownload size={16} stroke={1.5} />}
              >
                Download
              </Button>
              <Button
                variant="light"
                color="red"
                leftSection={<IconTrash size={16} stroke={1.5} />}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            </Group>
          )}
        </Stack>
      ) : (
        <Text c="dimmed">No voicemail file available.</Text>
      )}
    </Modal>
  );
}
