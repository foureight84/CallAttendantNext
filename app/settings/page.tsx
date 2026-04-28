'use client';

import { useEffect, useRef, useState } from 'react';
import { Stack, Title, Card, Group, Text, Button, Slider, NumberInput, Switch, Select, MultiSelect, Divider, Radio, TextInput, Box, Anchor, Tabs, Code, PasswordInput, Alert, Loader, Progress, Badge, Tooltip } from '@mantine/core';
import Link from 'next/link';
import { notifications } from '@mantine/notifications';
import { useForm } from '@mantine/form';
import { CronExpressionParser } from 'cron-parser';
import { apiClient } from '@/lib/api-client';
import type { AppSettings } from '@/lib/contract';
import { SetupWizard } from '@/components/SetupWizard';

const IPQS_COUNTRIES = [
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
  { value: 'AF', label: 'Afghanistan' },
  { value: 'AL', label: 'Albania' },
  { value: 'DZ', label: 'Algeria' },
  { value: 'AD', label: 'Andorra' },
  { value: 'AO', label: 'Angola' },
  { value: 'AG', label: 'Antigua and Barbuda' },
  { value: 'AR', label: 'Argentina' },
  { value: 'AM', label: 'Armenia' },
  { value: 'AU', label: 'Australia' },
  { value: 'AT', label: 'Austria' },
  { value: 'AZ', label: 'Azerbaijan' },
  { value: 'BS', label: 'Bahamas' },
  { value: 'BH', label: 'Bahrain' },
  { value: 'BD', label: 'Bangladesh' },
  { value: 'BB', label: 'Barbados' },
  { value: 'BY', label: 'Belarus' },
  { value: 'BE', label: 'Belgium' },
  { value: 'BZ', label: 'Belize' },
  { value: 'BJ', label: 'Benin' },
  { value: 'BT', label: 'Bhutan' },
  { value: 'BO', label: 'Bolivia' },
  { value: 'BA', label: 'Bosnia and Herzegovina' },
  { value: 'BW', label: 'Botswana' },
  { value: 'BR', label: 'Brazil' },
  { value: 'BN', label: 'Brunei' },
  { value: 'BG', label: 'Bulgaria' },
  { value: 'BF', label: 'Burkina Faso' },
  { value: 'BI', label: 'Burundi' },
  { value: 'CV', label: 'Cabo Verde' },
  { value: 'KH', label: 'Cambodia' },
  { value: 'CM', label: 'Cameroon' },
  { value: 'CF', label: 'Central African Republic' },
  { value: 'TD', label: 'Chad' },
  { value: 'CL', label: 'Chile' },
  { value: 'CN', label: 'China' },
  { value: 'CO', label: 'Colombia' },
  { value: 'KM', label: 'Comoros' },
  { value: 'CG', label: 'Congo' },
  { value: 'CD', label: 'Congo (DRC)' },
  { value: 'CR', label: 'Costa Rica' },
  { value: 'CI', label: "Côte d'Ivoire" },
  { value: 'HR', label: 'Croatia' },
  { value: 'CU', label: 'Cuba' },
  { value: 'CY', label: 'Cyprus' },
  { value: 'CZ', label: 'Czech Republic' },
  { value: 'DK', label: 'Denmark' },
  { value: 'DJ', label: 'Djibouti' },
  { value: 'DM', label: 'Dominica' },
  { value: 'DO', label: 'Dominican Republic' },
  { value: 'EC', label: 'Ecuador' },
  { value: 'EG', label: 'Egypt' },
  { value: 'SV', label: 'El Salvador' },
  { value: 'GQ', label: 'Equatorial Guinea' },
  { value: 'ER', label: 'Eritrea' },
  { value: 'EE', label: 'Estonia' },
  { value: 'SZ', label: 'Eswatini' },
  { value: 'ET', label: 'Ethiopia' },
  { value: 'FJ', label: 'Fiji' },
  { value: 'FI', label: 'Finland' },
  { value: 'FR', label: 'France' },
  { value: 'GA', label: 'Gabon' },
  { value: 'GM', label: 'Gambia' },
  { value: 'GE', label: 'Georgia' },
  { value: 'DE', label: 'Germany' },
  { value: 'GH', label: 'Ghana' },
  { value: 'GR', label: 'Greece' },
  { value: 'GD', label: 'Grenada' },
  { value: 'GT', label: 'Guatemala' },
  { value: 'GN', label: 'Guinea' },
  { value: 'GW', label: 'Guinea-Bissau' },
  { value: 'GY', label: 'Guyana' },
  { value: 'HT', label: 'Haiti' },
  { value: 'HN', label: 'Honduras' },
  { value: 'HU', label: 'Hungary' },
  { value: 'IS', label: 'Iceland' },
  { value: 'IN', label: 'India' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'IR', label: 'Iran' },
  { value: 'IQ', label: 'Iraq' },
  { value: 'IE', label: 'Ireland' },
  { value: 'IL', label: 'Israel' },
  { value: 'IT', label: 'Italy' },
  { value: 'JM', label: 'Jamaica' },
  { value: 'JP', label: 'Japan' },
  { value: 'JO', label: 'Jordan' },
  { value: 'KZ', label: 'Kazakhstan' },
  { value: 'KE', label: 'Kenya' },
  { value: 'KI', label: 'Kiribati' },
  { value: 'KW', label: 'Kuwait' },
  { value: 'KG', label: 'Kyrgyzstan' },
  { value: 'LA', label: 'Laos' },
  { value: 'LV', label: 'Latvia' },
  { value: 'LB', label: 'Lebanon' },
  { value: 'LS', label: 'Lesotho' },
  { value: 'LR', label: 'Liberia' },
  { value: 'LY', label: 'Libya' },
  { value: 'LI', label: 'Liechtenstein' },
  { value: 'LT', label: 'Lithuania' },
  { value: 'LU', label: 'Luxembourg' },
  { value: 'MG', label: 'Madagascar' },
  { value: 'MW', label: 'Malawi' },
  { value: 'MY', label: 'Malaysia' },
  { value: 'MV', label: 'Maldives' },
  { value: 'ML', label: 'Mali' },
  { value: 'MT', label: 'Malta' },
  { value: 'MH', label: 'Marshall Islands' },
  { value: 'MR', label: 'Mauritania' },
  { value: 'MU', label: 'Mauritius' },
  { value: 'MX', label: 'Mexico' },
  { value: 'FM', label: 'Micronesia' },
  { value: 'MD', label: 'Moldova' },
  { value: 'MC', label: 'Monaco' },
  { value: 'MN', label: 'Mongolia' },
  { value: 'ME', label: 'Montenegro' },
  { value: 'MA', label: 'Morocco' },
  { value: 'MZ', label: 'Mozambique' },
  { value: 'MM', label: 'Myanmar' },
  { value: 'NA', label: 'Namibia' },
  { value: 'NR', label: 'Nauru' },
  { value: 'NP', label: 'Nepal' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'NZ', label: 'New Zealand' },
  { value: 'NI', label: 'Nicaragua' },
  { value: 'NE', label: 'Niger' },
  { value: 'NG', label: 'Nigeria' },
  { value: 'KP', label: 'North Korea' },
  { value: 'MK', label: 'North Macedonia' },
  { value: 'NO', label: 'Norway' },
  { value: 'OM', label: 'Oman' },
  { value: 'PK', label: 'Pakistan' },
  { value: 'PW', label: 'Palau' },
  { value: 'PA', label: 'Panama' },
  { value: 'PG', label: 'Papua New Guinea' },
  { value: 'PY', label: 'Paraguay' },
  { value: 'PE', label: 'Peru' },
  { value: 'PH', label: 'Philippines' },
  { value: 'PL', label: 'Poland' },
  { value: 'PT', label: 'Portugal' },
  { value: 'QA', label: 'Qatar' },
  { value: 'RO', label: 'Romania' },
  { value: 'RU', label: 'Russia' },
  { value: 'RW', label: 'Rwanda' },
  { value: 'KN', label: 'Saint Kitts and Nevis' },
  { value: 'LC', label: 'Saint Lucia' },
  { value: 'VC', label: 'Saint Vincent and the Grenadines' },
  { value: 'WS', label: 'Samoa' },
  { value: 'SM', label: 'San Marino' },
  { value: 'ST', label: 'São Tomé and Príncipe' },
  { value: 'SA', label: 'Saudi Arabia' },
  { value: 'SN', label: 'Senegal' },
  { value: 'RS', label: 'Serbia' },
  { value: 'SC', label: 'Seychelles' },
  { value: 'SL', label: 'Sierra Leone' },
  { value: 'SG', label: 'Singapore' },
  { value: 'SK', label: 'Slovakia' },
  { value: 'SI', label: 'Slovenia' },
  { value: 'SB', label: 'Solomon Islands' },
  { value: 'SO', label: 'Somalia' },
  { value: 'ZA', label: 'South Africa' },
  { value: 'KR', label: 'South Korea' },
  { value: 'SS', label: 'South Sudan' },
  { value: 'ES', label: 'Spain' },
  { value: 'LK', label: 'Sri Lanka' },
  { value: 'SD', label: 'Sudan' },
  { value: 'SR', label: 'Suriname' },
  { value: 'SE', label: 'Sweden' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'SY', label: 'Syria' },
  { value: 'TW', label: 'Taiwan' },
  { value: 'TJ', label: 'Tajikistan' },
  { value: 'TZ', label: 'Tanzania' },
  { value: 'TH', label: 'Thailand' },
  { value: 'TL', label: 'Timor-Leste' },
  { value: 'TG', label: 'Togo' },
  { value: 'TO', label: 'Tonga' },
  { value: 'TT', label: 'Trinidad and Tobago' },
  { value: 'TN', label: 'Tunisia' },
  { value: 'TR', label: 'Turkey' },
  { value: 'TM', label: 'Turkmenistan' },
  { value: 'TV', label: 'Tuvalu' },
  { value: 'UG', label: 'Uganda' },
  { value: 'UA', label: 'Ukraine' },
  { value: 'AE', label: 'United Arab Emirates' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'UY', label: 'Uruguay' },
  { value: 'UZ', label: 'Uzbekistan' },
  { value: 'VU', label: 'Vanuatu' },
  { value: 'VE', label: 'Venezuela' },
  { value: 'VN', label: 'Vietnam' },
  { value: 'YE', label: 'Yemen' },
  { value: 'ZM', label: 'Zambia' },
  { value: 'ZW', label: 'Zimbabwe' },
];

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

function countCronRunsPerMonth(expr: string): number {
  try {
    const interval = CronExpressionParser.parse(expr);
    const cutoff = Date.now() + 30 * 24 * 60 * 60 * 1000;
    let count = 0;
    while (count < 200) {
      if (interval.next().toDate().getTime() > cutoff) break;
      count++;
    }
    return count;
  } catch {
    return 0;
  }
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
  const [wizardOpen, setWizardOpen] = useState(false);
  const [ipqsUsage, setIpqsUsage] = useState<{ credits: number; phoneUsage: number; exhausted: boolean } | null>(null);
  const [testingIpqs, setTestingIpqs] = useState(false);
  const [ipqsTestResult, setIpqsTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

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
      robocallCleanupUseIpqs: false,
      dtmfRemovalEnabled: false,
      dtmfRemovalKey: '9',
      wizardCompleted: false,
      ipqsApiKey: '',
      ipqsStrictness: 0,
      ipqsCountries: ['US', 'CA'],
    },
    validate: {
      ipqsApiKey: (value, values) => {
        if ((values.blockService === 'IPQS' || values.blockService === 'BOTH') && !value.trim()) {
          return 'API key is required when IPQS is enabled';
        }
        return null;
      },
    },
  });

  const fetchIpqsUsage = async () => {
    try {
      const res = await fetch('/api/settings/ipqs-usage');
      if (!res.ok) return;
      const d = await res.json() as { success: boolean; credits?: number; phoneUsage?: number; exhausted?: boolean };
      if (d.success && d.credits !== undefined && d.phoneUsage !== undefined) {
        setIpqsUsage({ credits: d.credits, phoneUsage: d.phoneUsage, exhausted: d.exhausted ?? false });
      }
    } catch { /* ignore */ }
  };

  useEffect(() => {
    apiClient.settings.get().then(data => {
      form.initialize({ ...data, mqttTopicPrefix: data.mqttTopicPrefix || 'callattendant' });
      if (data.blockService === 'IPQS' || data.blockService === 'BOTH') {
        fetchIpqsUsage();
      }
    });
    fetch('/api/piper/models').then(r => r.json()).then(setModels).catch(() => {});
    fetch('/api/blacklist/cleanup').then(r => r.json()).then((d: { running: boolean; pendingCount: number }) => {
      setCleanupRunning(d.running);
      setCleanupPendingCount(d.pendingCount);
    }).catch(() => {});
    return () => {
      if (cleanupPollRef.current) {
        clearInterval(cleanupPollRef.current);
        cleanupPollRef.current = null;
      }
    };
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

  const handleTestIpqs = async () => {
    setTestingIpqs(true);
    setIpqsTestResult(null);
    try {
      const { serialPort: _sp, serialBaudRate: _sbr, ...saveable } = form.values;
      await apiClient.settings.save(saveable);
      const res = await fetch('/api/settings/ipqs-usage');
      const d = await res.json() as { success: boolean; credits?: number; phoneUsage?: number; exhausted?: boolean; message?: string };
      if (d.success && d.credits !== undefined && d.phoneUsage !== undefined) {
        setIpqsUsage({ credits: d.credits, phoneUsage: d.phoneUsage, exhausted: d.exhausted ?? false });
        setIpqsTestResult({ ok: true, message: `Connected — ${d.phoneUsage} / ${d.credits} lookups used this period` });
      } else {
        setIpqsTestResult({ ok: false, message: d.message ?? 'Unexpected response from IPQS' });
      }
    } catch (err) {
      setIpqsTestResult({ ok: false, message: String(err) });
    } finally {
      setTestingIpqs(false);
    }
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
            <Group gap="sm">
              <Button variant="default" onClick={() => setWizardOpen(true)}>Setup Wizard</Button>
              <Button type="submit" disabled={!form.isDirty()}>Save Settings</Button>
            </Group>
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
                  { value: 'IPQS', label: 'IPQualityScore (IPQS)' },
                  { value: 'BOTH', label: 'Both (parallel — higher score wins)' },
                  { value: 'NONE', label: 'None (lists only)' },
                ]}
                allowDeselect={false}
                {...form.getInputProps('blockService')}
              />

              {(form.values.blockService === 'IPQS' || form.values.blockService === 'BOTH') && (
                <Stack gap="sm">
                  <Divider label="IPQualityScore Settings" labelPosition="left" />
                  <PasswordInput
                    label="IPQS API Key"
                    description={<>Required. Get a free key at <Anchor href="https://www.ipqualityscore.com/" target="_blank" size="xs">ipqualityscore.com</Anchor> (1,000 free lookups/month).</>}
                    withAsterisk
                    {...form.getInputProps('ipqsApiKey')}
                  />
                  <NumberInput
                    label="Strictness Level"
                    description="0 (default) to 3 — higher values increase fraud detection rigor and may raise scores."
                    min={0}
                    max={3}
                    {...form.getInputProps('ipqsStrictness')}
                  />
                  <MultiSelect
                    label="Country Filter"
                    description="Select the countries where this service is running. Leave empty to check all countries."
                    placeholder="Search countries…"
                    searchable
                    data={IPQS_COUNTRIES}
                    {...form.getInputProps('ipqsCountries')}
                  />
                  {ipqsUsage && (
                    <Stack gap={4}>
                      <Group justify="space-between">
                        <Text size="sm">Phone lookups this period</Text>
                        <Group gap="xs">
                          <Text size="sm" fw={500}>{ipqsUsage.phoneUsage} / {ipqsUsage.credits}</Text>
                          {ipqsUsage.exhausted && <Badge color="red" size="sm">Exhausted</Badge>}
                        </Group>
                      </Group>
                      <Tooltip label={`${ipqsUsage.phoneUsage} of ${ipqsUsage.credits} credits used`} position="bottom">
                        <Progress
                          value={(ipqsUsage.phoneUsage / Math.max(ipqsUsage.credits, 1)) * 100}
                          color={ipqsUsage.exhausted || ipqsUsage.phoneUsage / ipqsUsage.credits >= 0.95 ? 'red' : 'blue'}
                          size="sm"
                        />
                      </Tooltip>
                      {ipqsUsage.exhausted && (
                        <Alert color="orange" variant="light" p="xs">
                          Monthly credits exhausted — IPQS lookups are paused until the 1st of next month. Existing screening rules{form.values.blockService === 'BOTH' ? ' and Nomorobo' : ''} continue to run.
                        </Alert>
                      )}
                    </Stack>
                  )}
                  <Group>
                    <Button
                      variant="light"
                      size="xs"
                      loading={testingIpqs}
                      onClick={handleTestIpqs}
                      disabled={!form.values.ipqsApiKey.trim()}
                    >
                      Test API Key
                    </Button>
                    {ipqsTestResult && (
                      <Text size="xs" c={ipqsTestResult.ok ? 'green' : 'red'}>
                        {ipqsTestResult.message}
                      </Text>
                    )}
                  </Group>
                </Stack>
              )}
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
                that were auto-added by a screening service (Nomorobo or IPQS) against Nomorobo
                {form.values.robocallCleanupUseIpqs && form.values.ipqsApiKey ? ' and IPQS' : ''}. Numbers that are no longer
                flagged are automatically removed from your blocklist. Manually added entries are never touched.
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

                    {form.values.ipqsApiKey && (() => {
                      const runsPerMonth = countCronRunsPerMonth(form.values.robocallCleanupCron);
                      const creditsPerRun = cleanupPendingCount;
                      const creditsPerMonth = creditsPerRun * runsPerMonth;
                      const totalCredits = ipqsUsage?.credits ?? 1000;
                      const usedCredits = ipqsUsage?.phoneUsage ?? 0;
                      const remainingAfterCleanup = totalCredits - usedCredits - creditsPerMonth;
                      return (
                        <Stack gap={6} mt="xs">
                          <Group align="center" gap="sm">
                            <Switch
                              size="sm"
                              {...form.getInputProps('robocallCleanupUseIpqs', { type: 'checkbox' })}
                            />
                            <Text size="sm">Also verify with IPQS</Text>
                          </Group>
                          <Text size="xs" c="dimmed">
                            When enabled, a number is only removed if both Nomorobo and IPQS confirm it is no longer flagged.
                          </Text>
                          {form.values.robocallCleanupUseIpqs && (
                            <Box p="xs" style={{ borderRadius: 6, background: 'var(--mantine-color-default-hover)' }}>
                              <Text size="xs" fw={500} mb={4}>Estimated IPQS credit impact</Text>
                              <Text size="xs" c="dimmed">
                                {creditsPerRun} {creditsPerRun === 1 ? 'entry' : 'entries'} × {runsPerMonth} {runsPerMonth === 1 ? 'run' : 'runs'}/month = <strong>{creditsPerMonth} credits/month</strong>
                              </Text>
                              <Text size="xs" c={remainingAfterCleanup < 0 ? 'red' : remainingAfterCleanup < totalCredits * 0.1 ? 'orange' : 'dimmed'} mt={2}>
                                {ipqsUsage
                                  ? `${usedCredits} used + ${creditsPerMonth} cleanup = ${usedCredits + creditsPerMonth} of ${totalCredits} (${Math.max(0, remainingAfterCleanup)} remaining for live calls)`
                                  : `${creditsPerMonth} of ${totalCredits} allocated to cleanup`}
                              </Text>
                              {remainingAfterCleanup < 0 && (
                                <Text size="xs" c="red" mt={4}>
                                  Cleanup alone would exceed the monthly credit limit. Consider reducing cron frequency or upgrading your IPQS plan.
                                </Text>
                              )}
                            </Box>
                          )}
                        </Stack>
                      );
                    })()}
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
      <SetupWizard
        opened={wizardOpen}
        onClose={() => {
          setWizardOpen(false);
          apiClient.settings.get().then(data =>
            form.initialize({ ...data, mqttTopicPrefix: data.mqttTopicPrefix || 'callattendant' })
          );
        }}
      />
    </Stack>
  );
}
