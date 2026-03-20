'use client';

import { useEffect, useState } from 'react';
import { Stack, Title, Card, Group, Text, Button, Slider, NumberInput, Switch, Select, MultiSelect, Divider, Radio, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useForm } from '@mantine/form';
import { apiClient } from '@/lib/api-client';
import type { AppSettings } from '@/lib/contract';

export default function SettingsPage() {
  const [models, setModels] = useState<string[]>([]);
  const [previewText, setPreviewText] = useState('Hello, this is a test of the voice synthesis system.');
  const [previewing, setPreviewing] = useState(false);

  const form = useForm<AppSettings>({
    initialValues: {
      serialPort: '/dev/ttyUSB0',
      serialBaudRate: 57600,
      screeningMode: ['whitelist', 'blacklist'],
      blockService: 'NOMOROBO',
      spamThreshold: 2,
      ringsBeforeVm: 4,
      ringsBeforeVmScreened: 2,
      blocklistAction: 2,
      ringsBeforeVmBlocklist: 0,
      enableGpio: false,
      debugConsole: false,
      greetingVoice: '',
      greetingLengthScale: 1.0,
      logFile: './logs/modem.log',
      logMaxBytes: 5 * 1024 * 1024,
      logKeepFiles: 2,
    },
  });

  useEffect(() => {
    apiClient.settings.get().then(data => form.setValues(data));
    fetch('/api/piper/models').then(r => r.json()).then(setModels).catch(() => {});
  }, []);

  const handlePreview = async () => {
    if (!form.values.greetingVoice) return;
    setPreviewing(true);
    try {
      const res = await fetch('/api/piper/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: form.values.greetingVoice, text: previewText, lengthScale: form.values.greetingLengthScale }),
      });
      if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      new Audio(url).play();
    } catch (err) {
      notifications.show({ title: 'Preview failed', message: String(err), color: 'red', autoClose: 4000 });
    } finally {
      setPreviewing(false);
    }
  };

  const save = form.onSubmit(async (values) => {
    const { serialPort: _sp, serialBaudRate: _sbr, ...saveable } = values;
    await apiClient.settings.save(saveable);
    window.dispatchEvent(new Event('settings-saved'));
    notifications.show({ title: 'Settings saved', message: 'Your changes have been applied.', color: 'green', autoClose: 3000 });
  });

  return (
    <Stack gap="lg">
      <Title order={2}>Settings</Title>

      <form onSubmit={save}>
        <Stack gap="md">
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Title order={4} mb="md">Modem</Title>
            <Stack gap="sm">
              <Text size="sm">Serial Port: <strong>{form.values.serialPort}</strong></Text>
              <Text size="sm">Baud Rate: <strong>{form.values.serialBaudRate}</strong></Text>
              <Text size="xs" c="dimmed">Change via SERIAL_PORT and SERIAL_BAUD_RATE environment variables.</Text>
            </Stack>
          </Card>

          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Title order={4} mb="md">Screening</Title>
            <Stack gap="sm">
              <Group align="flex-end">
                <Select
                  label="Voice Model"
                  placeholder={models.length === 0 ? 'No .onnx models found in models directory' : 'Select a model'}
                  disabled={models.length === 0}
                  data={models.map(m => ({ value: m, label: m.replace('.onnx', '') }))}
                  value={form.values.greetingVoice}
                  onChange={(v) => form.setFieldValue('greetingVoice', v ?? '')}
                  style={{ flex: 1 }}
                />
                <NumberInput
                  label="Speed (length_scale)"
                  description="Higher = slower"
                  min={1.0}
                  max={1.5}
                  step={0.005}
                  decimalScale={3}
                  fixedDecimalScale
                  style={{ width: 160 }}
                  {...form.getInputProps('greetingLengthScale')}
                />
              </Group>
              <Group align="flex-end">
                <TextInput
                  label="Preview text"
                  style={{ flex: 1 }}
                  value={previewText}
                  onChange={(e) => setPreviewText(e.currentTarget.value)}
                />
                <Button
                  loading={previewing}
                  disabled={!form.values.greetingVoice}
                  onClick={handlePreview}
                >
                  Play
                </Button>
              </Group>
              <MultiSelect
                label="Screening Mode"
                data={[
                  { value: 'whitelist', label: 'Phonebook check' },
                  { value: 'blacklist', label: 'Blocklist check' },
                ]}
                {...form.getInputProps('screeningMode')}
              />
              <Select
                label="Block Service"
                data={[
                  { value: 'NOMOROBO', label: 'Nomorobo' },
                  { value: 'NONE', label: 'None (lists only)' },
                ]}
                {...form.getInputProps('blockService')}
              />
              <div>
                <Text size="sm" mb={4}>Spam Threshold: {form.values.spamThreshold}</Text>
                <Slider
                  min={1}
                  max={3}
                  step={1}
                  mb="xl"
                  mx={40}
                  marks={[
                    { value: 1, label: 'Suspicious' },
                    { value: 2, label: 'Likely spam' },
                    { value: 3, label: 'Confirmed' },
                  ]}
                  {...form.getInputProps('spamThreshold')}
                />
              </div>
            </Stack>
          </Card>

          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Title order={4} mb="md">Voicemail</Title>
            <Stack gap="sm">
              <NumberInput
                label="Rings Before Voicemail (permitted callers)"
                description="How many rings before sending a phonebook caller to voicemail."
                min={1}
                max={10}
                {...form.getInputProps('ringsBeforeVm')}
              />
              <NumberInput
                label="Rings Before Voicemail (unknown callers)"
                description="How many rings before sending an unrecognized or screened caller to voicemail."
                min={1}
                max={10}
                {...form.getInputProps('ringsBeforeVmScreened')}
              />
            </Stack>
          </Card>

          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Title order={4} mb="md">Blocklist</Title>
            <Stack gap="sm">
              <Radio.Group
                label="Action for blocked callers"
                {...form.getInputProps('blocklistAction')}
                value={String(form.values.blocklistAction)}
                onChange={v => form.setFieldValue('blocklistAction', Number(v))}
              >
                <Stack gap="xs" mt="xs">
                  <Radio value="1" label="Hang up silently (no notification)" />
                  <Radio value="2" label="Play blocked greeting then hang up" />
                  <Radio value="3" label="Send to voicemail after N rings" />
                </Stack>
              </Radio.Group>
              <NumberInput
                label="Rings before voicemail (blocklist)"
                description="How many rings before sending a blocked caller to voicemail."
                min={0}
                max={10}
                disabled={form.values.blocklistAction !== 3}
                {...form.getInputProps('ringsBeforeVmBlocklist')}
              />
            </Stack>
          </Card>

          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Title order={4} mb="md">Hardware</Title>
            <Switch
              label="Enable GPIO LEDs (Raspberry Pi)"
              {...form.getInputProps('enableGpio', { type: 'checkbox' })}
            />
          </Card>

          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Title order={4} mb="md">Debugging</Title>
            <Switch
              label="Enable Debug Console"
              description="Shows the Debug Console menu item and allows access to /debug."
              {...form.getInputProps('debugConsole', { type: 'checkbox' })}
            />
          </Card>

          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Title order={4} mb="md">Logging</Title>
            <Stack gap="sm">
              <TextInput
                label="Log File Path"
                description="Path to the modem log file (relative to the app root). Changes take effect immediately."
                {...form.getInputProps('logFile')}
              />
              <NumberInput
                label="Max Log File Size (bytes)"
                description="Rotate the log file when it exceeds this size. Default: 5 242 880 (5 MB)."
                min={65536}
                step={1048576}
                {...form.getInputProps('logMaxBytes')}
              />
              <NumberInput
                label="Rotated Files to Keep"
                description="Number of rotated backup files to retain (modem.log.1, .2, …)."
                min={0}
                max={10}
                {...form.getInputProps('logKeepFiles')}
              />
            </Stack>
          </Card>

          <Button type="submit">Save Settings</Button>
        </Stack>
      </form>
    </Stack>
  );
}
