'use client';

import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (opened && message && message.played === 0 && markedRef.current !== message.messageId) {
      markedRef.current = message.messageId;
      apiClient.messages.patch({ messageId: message.messageId, played: true }).catch(() => {});
    }
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
              onClick={handleDelete}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      ) : (
        <Text c="dimmed">No voicemail file available.</Text>
      )}
    </Modal>
  );
}
