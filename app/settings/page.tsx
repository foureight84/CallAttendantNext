'use client';

import { useEffect, useRef, useState } from 'react';
import { Stack, Title, Card, Group, Text, Button, Slider, NumberInput, Switch, Select, MultiSelect, Divider, Radio, TextInput, Box, Anchor, Tabs, Code, PasswordInput, Alert, Loader } from '@mantine/core';
import Link from 'next/link';
import { notifications } from '@mantine/notifications';
import { useForm } from '@mantine/form';
import { CronExpressionParser } from 'cron-parser';
import { apiClient } from '@/lib/api-client';
import type { AppSettings } from '@/lib/contract';

function parseCronFields(expr: string): [string, string, string, string, string] {
  const parts = expr.trim().split(/\s+/);
  return [parts[0] ?? '*', parts[1] ?? '*', parts[2] ?? '*', parts[3] ?? '*', parts[4] ?? '*'];
}

function getNextRunPreview(expr: string): string {
  try {
    const next = CronExpressionParser.parse(expr).next().toDate();
    return `Next run: ${next.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} at ${next.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return 'Invalid cron expression';
  }
}

function isCronValid(expr: string): boolean {
  try { CronExpressionParser.parse(expr); return true; } catch { return false; }
}

export default function SettingsPage() {
  const [models, setModels] = useState<string[]>([]);
  const [previewText, setPreviewText] = useState('Hello, this is a test of the voice synthesis system.');
  const [previewing, setPreviewing] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testingMqtt, setTestingMqtt] = useState(false);
  const [mqttTestResult, setMqttTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupPendingCount, setCleanupPendingCount] = useState(0);
  const cleanupPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const form = useForm<AppSettings>({
    initialValues: {
      serialPort: '/dev/ttyUSB0',
      serialBaudRate: 57600,
      screeningMode: ['whitelist', 'blacklist'],
      autoBlockSpam: true,
      blockService: 'NOMOROBO',
      spamThreshold: 2,
      ringsBeforeVm: 4,
      ringsBeforeVmScreened: 2,
      blocklistAction: 2,
      ringsBeforeVmBlocklist: 0,
      enableGpio: false,
      debugConsole: false,
      diagnosticMode: false,
      savePcmDebug: false,
      greetingVoice: '',
      greetingLengthScale: 1.0,
      logFile: './logs/modem.log',
      logMaxBytes: 5 * 1024 * 1024,
      logKeepFiles: 2,
      emailEnabled: false,
      emailHost: '',
      emailPort: 587,
      emailUser: '',
      emailPass: '',
      emailFrom: '',
      emailTo: '',
      emailNotifyVoicemail: true,
      emailNotifyBlocked: false,
      emailNotifyAll: false,
      mqttEnabled: false,
      mqttBrokerUrl: '',
      mqttUsername: '',
      mqttPassword: '',
      mqttTopicPrefix: 'callattendant',
      mqttNotifyVoicemail: true,
      mqttNotifyBlocked: true,
      mqttNotifyAll: false,
      robocallCleanupEnabled: false,
      robocallCleanupCron: '0 2 * * 6',
      dtmfRemovalEnabled: false,
      dtmfRemovalKey: '9',
    },
  });

  useEffect(() => {
    apiClient.settings.get().then(data => form.initialize({ ...data, mqttTopicPrefix: data.mqttTopicPrefix || 'callattendant' }));
    fetch('/api/piper/models').then(r => r.json()).then(setModels).catch(() => {});
    fetch('/api/blacklist/cleanup').then(r => r.json()).then((d: { running: boolean; pendingCount: number }) => {
      setCleanupRunning(d.running);
      setCleanupPendingCount(d.pendingCount);
    }).catch(() => {});
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

  const handleTestEmail = async () => {
    setTestingEmail(true);
    setEmailTestResult(null);
    try {
      // Save current email settings first so the test uses them
      const { serialPort: _sp, serialBaudRate: _sbr, ...saveable } = form.values;
      await apiClient.settings.save(saveable);
      const res = await fetch('/api/email/test', { method: 'POST' });
      const data = await res.json() as { ok: boolean; error?: string };
      setEmailTestResult(data);
    } catch (err) {
      setEmailTestResult({ ok: false, error: String(err) });
    } finally {
      setTestingEmail(false);
    }
  };

  const handleTestMqtt = async () => {
    setTestingMqtt(true);
    setMqttTestResult(null);
    try {
      const { serialPort: _sp, serialBaudRate: _sbr, ...saveable } = form.values;
      await apiClient.settings.save(saveable);
      const res = await fetch('/api/mqtt/test', { method: 'POST' });
      const data = await res.json() as { ok: boolean; error?: string };
      setMqttTestResult(data);
    } catch (err) {
      setMqttTestResult({ ok: false, error: String(err) });
    } finally {
      setTestingMqtt(false);
    }
  };

  const handleRunNow = async () => {
    setCleanupRunning(true);
    try {
      await fetch('/api/blacklist/cleanup', { method: 'POST' });
    } catch { /* ignore — cleanup runs in background */ }
    cleanupPollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/blacklist/cleanup');
        const d = await res.json() as { running: boolean; pendingCount: number };
        setCleanupRunning(d.running);
        setCleanupPendingCount(d.pendingCount);
        if (!d.running) {
          if (cleanupPollRef.current) { clearInterval(cleanupPollRef.current); cleanupPollRef.current = null; }
          notifications.show({ title: 'Cleanup complete', message: 'Robocall blocklist cleanup finished.', color: 'green', autoClose: 4000 });
        }
      } catch { /* network error — keep polling */ }
    }, 5000);
  };

  const save = form.onSubmit(async (values) => {
    const { serialPort: _sp, serialBaudRate: _sbr, ...saveable } = values;
    await apiClient.settings.save(saveable);
    form.resetDirty(values);
    window.dispatchEvent(new Event('settings-saved'));
    notifications.show({ title: 'Settings saved', message: 'Your changes have been applied.', color: 'green', autoClose: 3000 });
  });

  return (
    <Stack gap="lg">
      <form onSubmit={save}>
        <Stack gap="md">
          <Box
            style={{
              position: 'sticky',
              top: 'var(--app-shell-header-height, 0)',
              zIndex: 100,
              background: 'var(--mantine-color-body)',
              paddingTop: 8,
              paddingBottom: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <Title order={2}>Settings</Title>
            <Button type="submit" disabled={!form.isDirty()}>Save Settings</Button>
          </Box>

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
                  allowDeselect={false}
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
            <Title order={4} mb="md">Robocall Detection</Title>
            <Stack gap="sm">
              <Select
                label="Block Service"
                data={[
                  { value: 'NOMOROBO', label: 'Nomorobo' },
                  { value: 'NONE', label: 'None (lists only)' },
                ]}
                allowDeselect={false}
                {...form.getInputProps('blockService')}
              />
              <Switch
                label="Auto-block numbers that meet the spam threshold"
                description={
                  <>
                    When enabled, any caller flagged at or above the spam threshold is automatically added to the blocklist — saving time from having to look them up again.{' '}
                    <strong>Note:</strong> numbers stay blocked permanently until removed. Phone numbers can change hands, so a number that was a spam caller today may belong to a legitimate caller in the future.
                  </>
                }
                {...form.getInputProps('autoBlockSpam', { type: 'checkbox' })}
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

              <Divider mt="xs" />

              <Group align="center" gap="sm">
                <Switch
                  {...form.getInputProps('robocallCleanupEnabled', { type: 'checkbox' })}
                />
                <Text fw={500} size="sm">Robocall Cleanup</Text>
              </Group>
              <Text size="sm" c="dimmed">
                Phone numbers can change hands over time. This cleanup periodically re-checks blocklist entries
                that were added with &quot;Robocall&quot; as the reason against Nomorobo. Numbers that are no longer
                flagged are automatically removed from your blocklist.
              </Text>

              {form.values.robocallCleanupEnabled && (() => {
                const fields = parseCronFields(form.values.robocallCleanupCron);
                const setField = (i: number, v: string) => {
                  const next = [...fields] as [string, string, string, string, string];
                  next[i] = v;
                  form.setFieldValue('robocallCleanupCron', next.join(' '));
                };
                const valid = isCronValid(form.values.robocallCleanupCron);
                const estSecs = cleanupPendingCount * 10;
                const fmtDuration = (s: number) => {
                  const h = Math.floor(s / 3600);
                  const m = Math.floor((s % 3600) / 60);
                  const sec = s % 60;
                  const parts = [];
                  if (h > 0) parts.push(`${h}h`);
                  if (m > 0) parts.push(`${m}m`);
                  if (sec > 0 || parts.length === 0) parts.push(`${sec}s`);
                  return parts.join(' ');
                };
                return (
                  <Stack gap="xs">
                    <Group gap="xs" wrap="nowrap">
                      {(['Minute', 'Hour', 'Day', 'Month', 'Weekday'] as const).map((label, i) => (
                        <TextInput
                          key={label}
                          label={label}
                          value={fields[i]}
                          onChange={e => setField(i, e.currentTarget.value)}
                          style={{ width: 72 }}
                          styles={{ input: { fontFamily: 'monospace', textAlign: 'center' } }}
                        />
                      ))}
                    </Group>
                    <Text size="xs" c={valid ? 'dimmed' : 'red'}>
                      {valid ? getNextRunPreview(form.values.robocallCleanupCron) : 'Invalid cron expression'}
                    </Text>
                    <Group gap="sm" align="center">
                      <Button
                        size="xs"
                        variant="default"
                        disabled={cleanupRunning || !valid || form.isDirty('robocallCleanupEnabled') || form.isDirty('robocallCleanupCron')}
                        onClick={handleRunNow}
                        leftSection={cleanupRunning ? <Loader size={12} /> : undefined}
                      >
                        {cleanupRunning ? 'Cleanup in progress…' : 'Run Now'}
                      </Button>
                      {cleanupRunning && cleanupPendingCount > 0 && (
                        <Text size="xs" c="dimmed">
                          {cleanupPendingCount} remaining · ~{fmtDuration(estSecs)} left
                        </Text>
                      )}
                      {!cleanupRunning && cleanupPendingCount > 0 && (
                        <Text size="xs" c="dimmed">
                          {cleanupPendingCount} number{cleanupPendingCount === 1 ? '' : 's'} queued · ~{fmtDuration(estSecs)} to complete
                        </Text>
                      )}
                      {!cleanupRunning && cleanupPendingCount === 0 && (
                        <Text size="xs" c="dimmed">No robocall entries in blocklist</Text>
                      )}
                    </Group>
                  </Stack>
                );
              })()}

              <Divider mt="xs" />

              <Group align="center" gap="sm">
                <Switch
                  {...form.getInputProps('dtmfRemovalEnabled', { type: 'checkbox' })}
                />
                <Text fw={500} size="sm">Send DTMF Removal Key</Text>
              </Group>
              <Text size="sm" c="dimmed">
                The FCC requires telemarketers to maintain do-not-call lists and honor opt-out requests.
                Many robocaller systems accept a DTMF keypress to remove your number — though compliance
                is not guaranteed. When enabled, this key is sent to every blocked caller after the call
                is answered.
              </Text>
              <Text size="sm" c="dimmed">
                Most commonly used opt-out keys: <strong>9</strong> (most widely used), <strong>2</strong> (political/survey systems), <strong>*</strong> (some automated systems).
              </Text>
              <Select
                label="Key to press"
                data={['0','1','2','3','4','5','6','7','8','9','*','#'].map(k => ({ value: k, label: k }))}
                disabled={!form.values.dtmfRemovalEnabled}
                style={{ width: 120 }}
                allowDeselect={false}
                {...form.getInputProps('dtmfRemovalKey')}
              />
            </Stack>
          </Card>

          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Title order={4} mb="md">Email Notifications</Title>
            <Stack gap="sm">
              <Switch
                label="Enable email notifications"
                {...form.getInputProps('emailEnabled', { type: 'checkbox' })}
              />

              <Tabs defaultValue="gmail">
                <Tabs.List>
                  <Tabs.Tab value="gmail">Gmail</Tabs.Tab>
                  <Tabs.Tab value="outlook">Outlook</Tabs.Tab>
                  <Tabs.Tab value="icloud">iCloud</Tabs.Tab>
                  <Tabs.Tab value="custom">Custom SMTP</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="gmail" pt="xs">
                  <Stack gap={4}>
                    <Text size="sm">1. Enable <strong>2-Step Verification</strong> on your Google account.</Text>
                    <Text size="sm">2. Go to <Anchor href="https://myaccount.google.com/apppasswords" target="_blank" size="sm">myaccount.google.com/apppasswords</Anchor> and create an App Password.</Text>
                    <Text size="sm">3. Use these settings:</Text>
                    <Code block>Host: smtp.gmail.com{'\n'}Port: 587{'\n'}User: you@gmail.com{'\n'}Pass: (16-char app password)</Code>
                  </Stack>
                </Tabs.Panel>

                <Tabs.Panel value="outlook" pt="xs">
                  <Stack gap={4}>
                    <Text size="sm">Works with Outlook.com, Hotmail, and Microsoft 365 accounts.</Text>
                    <Text size="sm">Use your regular Microsoft account password (or an app password if MFA is enabled).</Text>
                    <Text size="sm">Settings:</Text>
                    <Code block>Host: smtp-mail.outlook.com{'\n'}Port: 587{'\n'}User: you@outlook.com{'\n'}Pass: your password</Code>
                    <Text size="xs" c="dimmed">For Microsoft 365 / work accounts, your admin may need to enable SMTP AUTH.</Text>
                  </Stack>
                </Tabs.Panel>

                <Tabs.Panel value="icloud" pt="xs">
                  <Stack gap={4}>
                    <Text size="sm">1. Enable <strong>two-factor authentication</strong> on your Apple ID.</Text>
                    <Text size="sm">2. Go to <Anchor href="https://appleid.apple.com" target="_blank" size="sm">appleid.apple.com</Anchor> → Sign-In and Security → App-Specific Passwords.</Text>
                    <Text size="sm">3. Generate an app-specific password and use these settings:</Text>
                    <Code block>Host: smtp.mail.me.com{'\n'}Port: 587{'\n'}User: you@icloud.com{'\n'}Pass: (app-specific password)</Code>
                  </Stack>
                </Tabs.Panel>

                <Tabs.Panel value="custom" pt="xs">
                  <Text size="sm">Enter your mail provider&apos;s SMTP settings below. Port 587 uses STARTTLS; port 465 uses SSL.</Text>
                </Tabs.Panel>
              </Tabs>

              <Divider />

              <Group grow align="flex-end">
                <TextInput
                  label="SMTP Host"
                  placeholder="smtp.gmail.com"
                  {...form.getInputProps('emailHost')}
                />
                <NumberInput
                  label="Port"
                  style={{ maxWidth: 100 }}
                  min={1}
                  max={65535}
                  {...form.getInputProps('emailPort')}
                />
              </Group>
              <TextInput
                label="Username"
                placeholder="you@gmail.com"
                {...form.getInputProps('emailUser')}
              />
              <PasswordInput
                label="Password / App Password"
                {...form.getInputProps('emailPass')}
              />
              <TextInput
                label="From address"
                description="Defaults to Username if left blank."
                placeholder="you@gmail.com"
                {...form.getInputProps('emailFrom')}
              />
              <TextInput
                label="Send notifications to"
                placeholder="you@gmail.com"
                {...form.getInputProps('emailTo')}
              />

              <Divider label="Notify on" labelPosition="left" />
              <Switch
                label="Voicemail received"
                {...form.getInputProps('emailNotifyVoicemail', { type: 'checkbox' })}
              />
              <Switch
                label="Blocked call"
                {...form.getInputProps('emailNotifyBlocked', { type: 'checkbox' })}
              />
              <Switch
                label="All calls (permitted, screened, blocked)"
                {...form.getInputProps('emailNotifyAll', { type: 'checkbox' })}
              />

              <Group>
                <Button
                  variant="default"
                  loading={testingEmail}
                  disabled={!form.values.emailHost || !form.values.emailUser || !form.values.emailPass || !form.values.emailTo}
                  onClick={handleTestEmail}
                >
                  Send test email
                </Button>
                {emailTestResult && (
                  <Alert color={emailTestResult.ok ? 'green' : 'red'} p="xs" style={{ flex: 1 }}>
                    {emailTestResult.ok ? 'Test email sent successfully.' : `Failed: ${emailTestResult.error}`}
                  </Alert>
                )}
              </Group>
            </Stack>
          </Card>

          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Title order={4} mb="md">MQTT Notifications</Title>
            <Stack gap="sm">
              <Switch
                label="Enable MQTT notifications"
                {...form.getInputProps('mqttEnabled', { type: 'checkbox' })}
              />

              <TextInput
                label="Broker URL"
                placeholder="mqtt://homeassistant.local:1883"
                description="Use mqtt:// for plain, mqtts:// for TLS."
                {...form.getInputProps('mqttBrokerUrl')}
              />
              <Group grow>
                <TextInput
                  label="Username"
                  placeholder="(optional)"
                  {...form.getInputProps('mqttUsername')}
                />
                <PasswordInput
                  label="Password"
                  placeholder="(optional)"
                  {...form.getInputProps('mqttPassword')}
                />
              </Group>
              <TextInput
                label="Topic prefix"
                placeholder="callattendant"
                description={`Publishes to {prefix}/call. Defaults to "callattendant".`}
                {...form.getInputProps('mqttTopicPrefix')}
              />

              <Divider label="Notify on" labelPosition="left" />
              <Switch
                label="Voicemail received"
                {...form.getInputProps('mqttNotifyVoicemail', { type: 'checkbox' })}
              />
              <Switch
                label="Blocked call"
                {...form.getInputProps('mqttNotifyBlocked', { type: 'checkbox' })}
              />
              <Switch
                label="All calls (permitted, screened, blocked)"
                {...form.getInputProps('mqttNotifyAll', { type: 'checkbox' })}
              />

              <Group>
                <Button
                  variant="default"
                  loading={testingMqtt}
                  disabled={!form.values.mqttBrokerUrl}
                  onClick={handleTestMqtt}
                >
                  Test connection
                </Button>
                {mqttTestResult && (
                  <Alert color={mqttTestResult.ok ? 'green' : 'red'} p="xs" style={{ flex: 1 }}>
                    {mqttTestResult.ok ? 'Connected and test message published.' : `Failed: ${mqttTestResult.error}`}
                  </Alert>
                )}
              </Group>
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
            <Stack gap="sm">
              <Switch
                label="Enable Debug Console"
                description="Shows the Debug Console menu item and allows access to /debug."
                {...form.getInputProps('debugConsole', { type: 'checkbox' })}
              />
              <Switch
                label="Enable Diagnostic Mode"
                description={
                  <>
                    Shows the Diagnostics menu item and allows access to{' '}
                    <Anchor component={Link} href="/diagnostic" size="sm">/diagnostic</Anchor>
                    {' '}— an interactive wizard for testing modem call handling end-to-end.
                  </>
                }
                {...form.getInputProps('diagnosticMode', { type: 'checkbox' })}
              />
              <Switch
                label="Save PCM debug files"
                description="Keep raw PCM recordings alongside MP3 voicemails. Enables a Download PCM button in the Voicemails page for analysis."
                {...form.getInputProps('savePcmDebug', { type: 'checkbox' })}
              />
            </Stack>
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

        </Stack>
      </form>
      <Text size="xs" c="dimmed" ta="center">v{process.env.NEXT_PUBLIC_APP_VERSION}</Text>
    </Stack>
  );
}
