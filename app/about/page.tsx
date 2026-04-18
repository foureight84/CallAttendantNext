'use client';

import { useEffect, useState } from 'react';
import { Title, Text, Stack, Card, Anchor, Alert, Badge, Group } from '@mantine/core';
import { IconInfoCircle, IconExternalLink } from '@tabler/icons-react';

const REPO_URL = 'https://github.com/foureight84/CallAttendantNext';
const README_UPDATING = `${REPO_URL}#updating`;

export default function AboutPage() {
  const current = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';
  const [hasUpdate, setHasUpdate] = useState(false);
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/version/check')
      .then(r => r.json())
      .then((d: { hasUpdate: boolean; latest: string | null }) => {
        if (d.hasUpdate && d.latest) {
          setHasUpdate(true);
          setLatest(d.latest);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <Stack>
      <Title order={2}>About</Title>

      <Card withBorder>
        <Stack gap="sm">
          <Group>
            <Text fw={500} w={80}>Project</Text>
            <Anchor href={REPO_URL} target="_blank" rel="noopener noreferrer">
              CallAttendantNext <IconExternalLink size={14} style={{ verticalAlign: 'middle' }} />
            </Anchor>
          </Group>
          <Group>
            <Text fw={500} w={80}>Version</Text>
            <Badge variant="light" color="blue">v{current}</Badge>
          </Group>
        </Stack>
      </Card>

      {hasUpdate && latest && (
        <Alert icon={<IconInfoCircle />} color="blue" title="Update Available">
          Version <strong>v{latest}</strong> is available.{' '}
          <Anchor href={`${REPO_URL}/releases/tag/v${latest}`} target="_blank" rel="noopener noreferrer">
            View release
          </Anchor>
          {' · '}
          <Anchor href={README_UPDATING} target="_blank" rel="noopener noreferrer">
            How to update
          </Anchor>
        </Alert>
      )}
    </Stack>
  );
}
