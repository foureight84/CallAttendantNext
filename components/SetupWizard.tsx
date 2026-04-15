'use client';

import { useState, useEffect } from 'react';
import {
  Modal, Stack, Group, Text, Button, Switch, Select,
  NumberInput, TextInput, PasswordInput, Slider, Radio, Alert, Anchor, Divider, Loader,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconInfoCircle, IconCheck } from '@tabler/icons-react';
import { apiClient } from '@/lib/api-client';

type WizardValues = {
  greetingVoice: string;
  greetingLengthScale: number;
  ringsBeforeVm: number;
  ringsBeforeVmScreened: number;
  autoBlockSpam: boolean;
  spamThreshold: number;
  blocklistAction: number;
  ringsBeforeVmBlocklist: number;
  robocallCleanupEnabled: boolean;
  robocallCleanupCron: string;
  dtmfRemovalEnabled: boolean;
  dtmfRemovalKey: string;
  emailEnabled: boolean;
  emailHost: string;
  emailPort: number;
  emailUser: string;
  emailPass: string;
  emailFrom: string;
  emailTo: string;
  emailNotifyVoicemail: boolean;
  emailNotifyBlocked: boolean;
  emailNotifyAll: boolean;
  mqttEnabled: boolean;
  mqttBrokerUrl: string;
  mqttUsername: string;
  mqttPassword: string;
  mqttTopicPrefix: string;
  mqttNotifyVoicemail: boolean;
  mqttNotifyBlocked: boolean;
  mqttNotifyAll: boolean;
  enableGpio: boolean;
  debugConsole: boolean;
  diagnosticMode: boolean;
  savePcmDebug: boolean;
  logFile: string;
  logMaxBytes: number;
  logKeepFiles: number;
};

const DEFAULTS: WizardValues = {
  greetingVoice: '',
  greetingLengthScale: 1.0,
  ringsBeforeVm: 4,
  ringsBeforeVmScreened: 1,
  autoBlockSpam: true,
  spamThreshold: 2,
  blocklistAction: 2,
  ringsBeforeVmBlocklist: 0,
  robocallCleanupEnabled: false,
  robocallCleanupCron: '0 2 * * 6',
  dtmfRemovalEnabled: false,
  dtmfRemovalKey: '9',
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
  enableGpio: false,
  debugConsole: false,
  diagnosticMode: false,
  savePcmDebug: false,
  logFile: './logs/modem.log',
  logMaxBytes: 5 * 1024 * 1024,
  logKeepFiles: 2,
};

// Steps: 0=Welcome, 1–12=Content, 13=Complete
const STEP_TITLES = [
  'Setup Wizard',       // 0
  'Modem',              // 1
  'Voice Model',        // 2
  'Voicemail',          // 3
  'Robocall Detection', // 4
  'Blocklist',          // 5
  'Robocall Cleanup',   // 6
  'DTMF Removal',       // 7
  'Email Notifications',// 8
  'MQTT',               // 9
  'Hardware',           // 10
  'Debugging',          // 11
  'Logging',            // 12
  'Setup Complete',     // 13
];
const TOTAL_STEPS = STEP_TITLES.length; // 14 (0–13)
const CONTENT_STEPS = TOTAL_STEPS - 2;  // 12 (steps 1–12)
const SKIPPABLE = new Set([6, 7, 8, 9, 10, 11, 12]);

export interface SetupWizardProps {
  opened: boolean;
  onClose: () => void;
}

export function SetupWizard({ opened, onClose }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [models, setModels] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<WizardValues>(DEFAULTS);
  const [modemStatus, setModemStatus] = useState<{ connected: boolean; port: string } | null>(null);
  const [modemRestarting, setModemRestarting] = useState(false);

  const set = <K extends keyof WizardValues>(key: K, val: WizardValues[K]) =>
    setValues(v => ({ ...v, [key]: val }));

  // Initialize from current settings when wizard opens
  useEffect(() => {
    if (!opened) return;
    setStep(0);
    apiClient.settings.get().then(s => {
      setValues({
        greetingVoice: s.greetingVoice,
        greetingLengthScale: s.greetingLengthScale,
        ringsBeforeVm: s.ringsBeforeVm,
        ringsBeforeVmScreened: s.ringsBeforeVmScreened,
        autoBlockSpam: s.autoBlockSpam,
        spamThreshold: s.spamThreshold,
        blocklistAction: s.blocklistAction,
        ringsBeforeVmBlocklist: s.ringsBeforeVmBlocklist,
        robocallCleanupEnabled: s.robocallCleanupEnabled,
        robocallCleanupCron: s.robocallCleanupCron,
        dtmfRemovalEnabled: s.dtmfRemovalEnabled,
        dtmfRemovalKey: s.dtmfRemovalKey,
        emailEnabled: s.emailEnabled,
        emailHost: s.emailHost,
        emailPort: s.emailPort,
        emailUser: s.emailUser,
        emailPass: s.emailPass,
        emailFrom: s.emailFrom,
        emailTo: s.emailTo,
        emailNotifyVoicemail: s.emailNotifyVoicemail,
        emailNotifyBlocked: s.emailNotifyBlocked,
        emailNotifyAll: s.emailNotifyAll,
        mqttEnabled: s.mqttEnabled,
        mqttBrokerUrl: s.mqttBrokerUrl,
        mqttUsername: s.mqttUsername,
        mqttPassword: s.mqttPassword,
        mqttTopicPrefix: s.mqttTopicPrefix || 'callattendant',
        mqttNotifyVoicemail: s.mqttNotifyVoicemail,
        mqttNotifyBlocked: s.mqttNotifyBlocked,
        mqttNotifyAll: s.mqttNotifyAll,
        enableGpio: s.enableGpio,
        debugConsole: s.debugConsole,
        diagnosticMode: s.diagnosticMode,
        savePcmDebug: s.savePcmDebug,
        logFile: s.logFile,
        logMaxBytes: s.logMaxBytes,
        logKeepFiles: s.logKeepFiles,
      });
    }).catch(() => {});
    fetch('/api/piper/models').then(r => r.json()).then(setModels).catch(() => {});
  }, [opened]);

  // Fetch modem status whenever the modem screen is shown
  useEffect(() => {
    if (step !== 1) return;
    setModemStatus(null);
    fetch('/api/modem')
      .then(r => r.json())
      .then(d => setModemStatus(d as { connected: boolean; port: string }))
      .catch(() => setModemStatus({ connected: false, port: '' }));
  }, [step]);

  const next = () => setStep(s => Math.min(s + 1, TOTAL_STEPS - 1));
  const back = () => setStep(s => Math.max(s - 1, 0));

  const finish = async () => {
    setSaving(true);
    try {
      await apiClient.settings.save({ ...values, wizardCompleted: true });
      window.dispatchEvent(new Event('settings-saved'));
      onClose();
    } catch (err) {
      notifications.show({ title: 'Save failed', message: String(err), color: 'red', autoClose: 4000 });
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!values.greetingVoice) return;
    setPreviewing(true);
    try {
      const res = await fetch('/api/piper/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: values.greetingVoice, text: 'Hello, please leave a message after the tone.', lengthScale: values.greetingLengthScale }),
      });
      if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
      const blob = await res.blob();
      new Audio(URL.createObjectURL(blob)).play();
    } catch (err) {
      notifications.show({ title: 'Preview failed', message: String(err), color: 'red', autoClose: 4000 });
    } finally {
      setPreviewing(false);
    }
  };

  const renderScreen = () => {
    switch (step) {
      case 0:
        return (
          <Stack gap="md">
            <Text size="lg" fw={500}>Welcome to Call Attendant!</Text>
            <Text>
              This wizard walks you through the essential settings to get your call screener up and running.
              You can always adjust any setting from the Settings page later.
            </Text>
            <Text>
              The first five screens cover the core setup. The remaining screens are optional — skip any
              you don&apos;t need and configure them later.
            </Text>
          </Stack>
        );

      case 1:
        return (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Checking that your modem is connected and accessible on the configured serial port.
            </Text>
            {modemStatus === null ? (
              <Group gap="sm">
                <Loader size="sm" />
                <Text size="sm" c="dimmed">Checking modem status…</Text>
              </Group>
            ) : modemStatus.connected ? (
              <Alert color="green" icon={<IconCheck size={16} />}>
                Modem detected on <strong>{modemStatus.port}</strong>.
              </Alert>
            ) : (
              <Stack gap="sm">
                <Alert color="orange" icon={<IconAlertCircle size={16} />}>
                  No modem detected on <strong>{modemStatus.port || 'the configured serial port'}</strong>.
                </Alert>
                <Text size="sm">
                  If the modem is plugged in but on a different port, update <code>SERIAL_PORT</code> in
                  your <code>.env</code> file, then click <strong>Restart Modem</strong> below — no full
                  Call Attendant restart needed. On Linux you can find your modem with:
                </Text>
                <Text size="sm" ff="monospace" c="dimmed" style={{ background: 'var(--mantine-color-default)', padding: '6px 10px', borderRadius: 4 }}>
                  ls /dev/ttyUSB* /dev/ttyACM* 2&gt;/dev/null
                </Text>
                <Text size="sm" c="dimmed">
                  You can also continue the wizard and fix the modem configuration later. Call screening
                  will not work until the modem is detected.
                </Text>
                <Button
                  variant="default"
                  size="xs"
                  loading={modemRestarting}
                  style={{ alignSelf: 'flex-start' }}
                  onClick={async () => {
                    setModemRestarting(true);
                    try {
                      await fetch('/api/modem/restart', { method: 'POST' });
                    } catch { /* ignore — status check below will reflect reality */ }
                    const d = await fetch('/api/modem').then(r => r.json()).catch(() => ({ connected: false, port: '' }));
                    setModemStatus(d as { connected: boolean; port: string });
                    setModemRestarting(false);
                  }}
                >
                  Restart Modem
                </Button>
              </Stack>
            )}
          </Stack>
        );

      case 2:
        return (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Select the voice model your call attendant will use when greeting callers and announcing screened calls.
            </Text>
            {models.length === 0 && (
              <Alert color="yellow" icon={<IconAlertCircle size={16} />}>
                No voice models found in <code>piper-models/</code>. Run <code>bash setup.sh</code> from the project
                root to download the default models, then reload this page.
              </Alert>
            )}
            <Select
              label="Voice Model"
              placeholder={models.length === 0 ? 'No .onnx models found in piper-models/' : 'Select a model'}
              disabled={models.length === 0}
              data={models.map(m => ({ value: m, label: m.replace('.onnx', '') }))}
              value={values.greetingVoice}
              onChange={v => set('greetingVoice', v ?? '')}
              allowDeselect={false}
            />
            <Group align="flex-end">
              <NumberInput
                label="Speech speed (length_scale)"
                description="Higher = slower. 1.0 is default speed."
                min={1.0}
                max={1.5}
                step={0.005}
                decimalScale={3}
                fixedDecimalScale
                style={{ flex: 1 }}
                value={values.greetingLengthScale}
                onChange={v => typeof v === 'number' && set('greetingLengthScale', v)}
              />
              <Button
                variant="default"
                loading={previewing}
                disabled={!values.greetingVoice}
                onClick={handlePreview}
              >
                Preview
              </Button>
            </Group>
          </Stack>
        );

      case 3:
        return (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Configure how many rings before Call Attendant answers and takes a voicemail.
            </Text>
            <Alert color="blue" icon={<IconInfoCircle size={16} />}>
              <Stack gap={4}>
                <Text size="sm">
                  A standard telecom ring cycle is ~6 s on / ~4 s off. Most carriers stop ringing after
                  4–6 rings (~30–40 s total).
                </Text>
                <Text size="sm">
                  Caller ID is not transmitted until after the first ring completes, so the minimum useful
                  setting is 1.
                </Text>
                <Text size="sm">
                  If your physical phone supports first-ring suppression, setting unknown callers to 1 ring
                  means the phone won&apos;t ring audibly before Call Attendant answers.
                </Text>
              </Stack>
            </Alert>
            <NumberInput
              label="Rings before voicemail — phonebook callers"
              description="Permitted callers in your phonebook. Default: 4."
              min={1}
              max={10}
              value={values.ringsBeforeVm}
              onChange={v => typeof v === 'number' && set('ringsBeforeVm', v)}
            />
            <NumberInput
              label="Rings before voicemail — unknown callers"
              description="Unrecognized or screened callers. Default: 1."
              min={1}
              max={10}
              value={values.ringsBeforeVmScreened}
              onChange={v => typeof v === 'number' && set('ringsBeforeVmScreened', v)}
            />
          </Stack>
        );

      case 4:
        return (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Call Attendant can check incoming calls against the Nomorobo robocall database. Numbers that
              meet the spam threshold are blocked or screened based on your blocklist action.
            </Text>
            <Switch
              label="Auto-add flagged numbers to blocklist"
              description="When enabled, callers that meet the spam threshold are automatically added to the blocklist so future calls are blocked immediately."
              checked={values.autoBlockSpam}
              onChange={e => set('autoBlockSpam', e.currentTarget.checked)}
            />
            <div>
              <Text size="sm" fw={500} mb={4}>Spam threshold</Text>
              <Text size="xs" c="dimmed" mb="sm">
                Nomorobo scores callers 0–2. A lower threshold catches more robocallers but may occasionally flag
                legitimate callers. &quot;Likely spam&quot; is the recommended default.
              </Text>
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
                value={values.spamThreshold}
                onChange={v => set('spamThreshold', v)}
              />
            </div>
          </Stack>
        );

      case 5:
        return (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Choose what happens when a caller is on your blocklist.
            </Text>
            <Radio.Group
              label="Action for blocked callers"
              value={String(values.blocklistAction)}
              onChange={v => set('blocklistAction', Number(v))}
            >
              <Stack gap="xs" mt="xs">
                <Radio
                  value="1"
                  label="Hang up silently"
                  description="Answer and immediately disconnect. No audio played, no voicemail."
                />
                <Radio
                  value="2"
                  label="Play blocked greeting, then hang up"
                  description="Inform the caller that their number is blocked, then disconnect."
                />
                <Radio
                  value="3"
                  label="Ring N times, then send to voicemail"
                  description="Let the phone ring so you know someone called, then take a voicemail."
                />
              </Stack>
            </Radio.Group>
            {values.blocklistAction === 3 && (
              <NumberInput
                label="Rings before voicemail (blocklist)"
                description="How many rings before sending a blocked caller to voicemail."
                min={0}
                max={10}
                value={values.ringsBeforeVmBlocklist}
                onChange={v => typeof v === 'number' && set('ringsBeforeVmBlocklist', v)}
              />
            )}
          </Stack>
        );

      case 6:
        return (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Phone numbers can change hands over time. This feature periodically re-checks blocklist entries
              that were added for robocalling against Nomorobo and removes numbers that are no longer flagged.
            </Text>
            <Switch
              label="Enable robocall cleanup"
              checked={values.robocallCleanupEnabled}
              onChange={e => set('robocallCleanupEnabled', e.currentTarget.checked)}
            />
            {values.robocallCleanupEnabled && (
              <TextInput
                label="Schedule (cron expression)"
                description="When to run the cleanup. Default: Saturdays at 2:00 AM."
                placeholder="0 2 * * 6"
                value={values.robocallCleanupCron}
                onChange={e => set('robocallCleanupCron', e.currentTarget.value)}
              />
            )}
          </Stack>
        );

      case 7:
        return (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              The FCC requires telemarketers to maintain do-not-call lists and honor opt-out requests.
              Many robocaller systems accept a DTMF keypress to remove your number — though compliance
              is not guaranteed. When enabled, this key is sent to every blocked caller after the call
              is answered.
            </Text>
            <Text size="sm" c="dimmed">
              Most commonly used opt-out keys: <strong>9</strong> (most widely used), <strong>2</strong>{' '}
              (political/survey systems), <strong>*</strong> (some automated systems).
            </Text>
            <Switch
              label="Send DTMF removal key to blocked callers"
              checked={values.dtmfRemovalEnabled}
              onChange={e => set('dtmfRemovalEnabled', e.currentTarget.checked)}
            />
            {values.dtmfRemovalEnabled && (
              <Select
                label="Key to press"
                data={['0','1','2','3','4','5','6','7','8','9','*','#'].map(k => ({ value: k, label: k }))}
                value={values.dtmfRemovalKey}
                onChange={v => set('dtmfRemovalKey', v ?? '9')}
                allowDeselect={false}
                style={{ width: 120 }}
              />
            )}
          </Stack>
        );

      case 8:
        return (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Receive an email when a voicemail is left or a call is blocked.
            </Text>
            <Switch
              label="Enable email notifications"
              checked={values.emailEnabled}
              onChange={e => set('emailEnabled', e.currentTarget.checked)}
            />
            {values.emailEnabled && (
              <Stack gap="sm">
                <Group grow align="flex-end">
                  <TextInput
                    label="SMTP Host"
                    placeholder="smtp.gmail.com"
                    value={values.emailHost}
                    onChange={e => set('emailHost', e.currentTarget.value)}
                  />
                  <NumberInput
                    label="Port"
                    style={{ maxWidth: 100 }}
                    min={1}
                    max={65535}
                    value={values.emailPort}
                    onChange={v => typeof v === 'number' && set('emailPort', v)}
                  />
                </Group>
                <TextInput
                  label="Username"
                  placeholder="you@gmail.com"
                  value={values.emailUser}
                  onChange={e => set('emailUser', e.currentTarget.value)}
                />
                <PasswordInput
                  label="Password / App Password"
                  value={values.emailPass}
                  onChange={e => set('emailPass', e.currentTarget.value)}
                />
                <TextInput
                  label="Send notifications to"
                  placeholder="you@gmail.com"
                  value={values.emailTo}
                  onChange={e => set('emailTo', e.currentTarget.value)}
                />
                <Divider label="Notify on" labelPosition="left" />
                <Switch
                  label="Voicemail received"
                  checked={values.emailNotifyVoicemail}
                  onChange={e => set('emailNotifyVoicemail', e.currentTarget.checked)}
                />
                <Switch
                  label="Blocked call"
                  checked={values.emailNotifyBlocked}
                  onChange={e => set('emailNotifyBlocked', e.currentTarget.checked)}
                />
                <Switch
                  label="All calls (permitted, screened, blocked)"
                  checked={values.emailNotifyAll}
                  onChange={e => set('emailNotifyAll', e.currentTarget.checked)}
                />
              </Stack>
            )}
          </Stack>
        );

      case 9:
        return (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Publish call events to an MQTT broker. This is the recommended integration for{' '}
              <Anchor href="https://github.com/foureight84/CallAttendantNext_Monitor" target="_blank" size="sm">
                CallAttendantNext Monitor
              </Anchor>
              {' '}— a Home Assistant integration that shows call activity on your dashboard.
            </Text>
            <Switch
              label="Enable MQTT"
              checked={values.mqttEnabled}
              onChange={e => set('mqttEnabled', e.currentTarget.checked)}
            />
            {values.mqttEnabled && (
              <Stack gap="sm">
                <TextInput
                  label="Broker URL"
                  placeholder="mqtt://homeassistant.local:1883"
                  description="Use mqtt:// for plain, mqtts:// for TLS."
                  value={values.mqttBrokerUrl}
                  onChange={e => set('mqttBrokerUrl', e.currentTarget.value)}
                />
                <Group grow>
                  <TextInput
                    label="Username"
                    placeholder="(optional)"
                    value={values.mqttUsername}
                    onChange={e => set('mqttUsername', e.currentTarget.value)}
                  />
                  <PasswordInput
                    label="Password"
                    placeholder="(optional)"
                    value={values.mqttPassword}
                    onChange={e => set('mqttPassword', e.currentTarget.value)}
                  />
                </Group>
                <TextInput
                  label="Topic prefix"
                  placeholder="callattendant"
                  description={`Publishes to {prefix}/call. Defaults to "callattendant".`}
                  value={values.mqttTopicPrefix}
                  onChange={e => set('mqttTopicPrefix', e.currentTarget.value)}
                />
                <Divider label="Notify on" labelPosition="left" />
                <Switch
                  label="Voicemail received"
                  checked={values.mqttNotifyVoicemail}
                  onChange={e => set('mqttNotifyVoicemail', e.currentTarget.checked)}
                />
                <Switch
                  label="Blocked call"
                  checked={values.mqttNotifyBlocked}
                  onChange={e => set('mqttNotifyBlocked', e.currentTarget.checked)}
                />
                <Switch
                  label="All calls (permitted, screened, blocked)"
                  checked={values.mqttNotifyAll}
                  onChange={e => set('mqttNotifyAll', e.currentTarget.checked)}
                />
              </Stack>
            )}
          </Stack>
        );

      case 10:
        return (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Raspberry Pi only. Enables GPIO LED indicators that show call status in real time.
              See the{' '}
              <Anchor
                href="https://github.com/emxsys/callattendant/wiki/Advanced#led-indicators"
                target="_blank"
                size="sm"
              >
                LED wiring guide
              </Anchor>
              {' '}for wiring instructions. Skip this if you are not running on a Raspberry Pi.
            </Text>
            <Switch
              label="Enable GPIO LEDs (Raspberry Pi)"
              checked={values.enableGpio}
              onChange={e => set('enableGpio', e.currentTarget.checked)}
            />
          </Stack>
        );

      case 11:
        return (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              These options are primarily for development and troubleshooting. Leave them off unless you
              need to diagnose an issue.
            </Text>
            <Switch
              label="Enable Debug Console"
              description="Adds a Debug Console menu item for monitoring modem serial output."
              checked={values.debugConsole}
              onChange={e => set('debugConsole', e.currentTarget.checked)}
            />
            <Switch
              label="Enable Diagnostic Mode"
              description="Adds a Diagnostics menu item for testing call handling end-to-end."
              checked={values.diagnosticMode}
              onChange={e => set('diagnosticMode', e.currentTarget.checked)}
            />
            <Switch
              label="Save PCM debug files"
              description="Keep raw PCM recordings alongside MP3 voicemails for analysis."
              checked={values.savePcmDebug}
              onChange={e => set('savePcmDebug', e.currentTarget.checked)}
            />
          </Stack>
        );

      case 12:
        return (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Configure where logs are written and how large they can grow before rotating.
              If you&apos;re not sure, leave these as-is — the defaults work for most setups.
            </Text>
            <TextInput
              label="Log File Path"
              description="Relative to the Call Attendant root directory."
              value={values.logFile}
              onChange={e => set('logFile', e.currentTarget.value)}
            />
            <NumberInput
              label="Max Log File Size (bytes)"
              description="Rotate when this size is exceeded. Default: 5,242,880 (5 MB)."
              min={65536}
              step={1048576}
              value={values.logMaxBytes}
              onChange={v => typeof v === 'number' && set('logMaxBytes', v)}
            />
            <NumberInput
              label="Rotated Files to Keep"
              description="Number of backup files to retain (modem.log.1, .2, …)."
              min={0}
              max={10}
              value={values.logKeepFiles}
              onChange={v => typeof v === 'number' && set('logKeepFiles', v)}
            />
          </Stack>
        );

      case 13:
        return (
          <Stack gap="md" ta="center" py="xl">
            <Text size="xl" fw={600}>You&apos;re all set!</Text>
            <Text>
              Click <strong>Finish</strong> to save your settings and start using Call Attendant.
            </Text>
            <Text size="sm" c="dimmed">
              You can adjust any setting at any time from the Settings page. Use the{' '}
              <strong>Setup Wizard</strong> button there to run this wizard again.
            </Text>
          </Stack>
        );

      default:
        return null;
    }
  };

  const modalTitle =
    step === 0 ? 'Setup Wizard' :
    step === TOTAL_STEPS - 1 ? 'Setup Complete' :
    `Step ${step} of ${CONTENT_STEPS} — ${STEP_TITLES[step]}`;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="lg"
      title={modalTitle}
      styles={{ header: { borderBottom: '1px solid var(--mantine-color-default-border)' } }}
    >
      <Stack gap="lg" py="sm">
        {renderScreen()}

        <Divider />

        <Group justify={step === 0 ? 'flex-end' : 'space-between'}>
          {step > 0 && (
            <Button variant="default" onClick={back}>Back</Button>
          )}
          <Group gap="sm">
            {SKIPPABLE.has(step) && (
              <Button variant="subtle" onClick={next}>Skip</Button>
            )}
            {step === 0 && (
              <Button onClick={next}>Get Started</Button>
            )}
            {step > 0 && step < TOTAL_STEPS - 1 && (
              <Button onClick={next}>Next</Button>
            )}
            {step === TOTAL_STEPS - 1 && (
              <Button onClick={finish} loading={saving}>Finish</Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
