
export const config = {
  serialPort: process.env.SERIAL_PORT ?? '/dev/ttyUSB0',
  serialBaudRate: parseInt(process.env.SERIAL_BAUD_RATE ?? '57600', 10),
  dbPath: process.env.DB_PATH ?? './callattendant.db',
  messagesDir: process.env.MESSAGES_DIR ?? './messages',
  screeningMode: (process.env.SCREENING_MODE ?? 'whitelist,blacklist').split(',').map(s => s.trim()),
  blockService: process.env.BLOCK_SERVICE ?? 'NOMOROBO',
  spamThreshold: parseInt(process.env.SPAM_THRESHOLD ?? '2', 10),
  ipqsApiKey: process.env.IPQS_API_KEY ?? '',
  ipqsStrictness: parseInt(process.env.IPQS_STRICTNESS ?? '0', 10),
  ipqsCountries: (process.env.IPQS_COUNTRIES ?? '').split(',').map(s => s.trim()).filter(Boolean),
  ringsBeforeVm: parseInt(process.env.RINGS_BEFORE_VM ?? '4', 10),
  ringsBeforeVmScreened:  parseInt(process.env.RINGS_BEFORE_VM_SCREENED  ?? '2', 10),
  blocklistAction:        parseInt(process.env.BLOCKLIST_ACTION           ?? '2', 10),
  ringsBeforeVmBlocklist: parseInt(process.env.RINGS_BEFORE_VM_BLOCKLIST  ?? '0', 10),
  autoBlockSpam: process.env.AUTO_BLOCK_SPAM !== 'false',
  enableGpio: process.env.ENABLE_GPIO === 'true',
  debugConsole: process.env.DEBUG_CONSOLE === 'true',
  diagnosticMode: process.env.DIAGNOSTIC_MODE === 'true',
  savePcmDebug: process.env.SAVE_PCM_DEBUG === 'true',
  port: parseInt(process.env.PORT ?? '3000', 10),
  piperBinary:      process.env.PIPER_BINARY       ?? 'piper',
  piperModelsDir:   process.env.PIPER_MODELS_DIR   ?? './piper-models',
  piperLengthScale: parseFloat(process.env.PIPER_LENGTH_SCALE ?? '1.0'),
  logFile:          process.env.LOG_FILE            ?? './logs/modem.log',
  logMaxBytes:      parseInt(process.env.LOG_MAX_BYTES  ?? String(5 * 1024 * 1024), 10),
  logKeepFiles:     parseInt(process.env.LOG_KEEP_FILES ?? '2', 10),
  emailEnabled:     process.env.EMAIL_ENABLED         === 'true',
  emailHost:        process.env.EMAIL_HOST             ?? '',
  emailPort:        parseInt(process.env.EMAIL_PORT    ?? '587', 10),
  emailUser:        process.env.EMAIL_USER             ?? '',
  emailPass:        process.env.EMAIL_PASS             ?? '',
  emailFrom:        process.env.EMAIL_FROM             ?? '',
  emailTo:          process.env.EMAIL_TO               ?? '',
  emailNotifyVoicemail: process.env.EMAIL_NOTIFY_VOICEMAIL !== 'false',
  emailNotifyBlocked:   process.env.EMAIL_NOTIFY_BLOCKED   === 'true',
  emailNotifyAll:       process.env.EMAIL_NOTIFY_ALL        === 'true',
  mqttEnabled:          process.env.MQTT_ENABLED            === 'true',
  mqttBrokerUrl:        process.env.MQTT_BROKER_URL         ?? '',
  mqttUsername:         process.env.MQTT_USERNAME           ?? '',
  mqttPassword:         process.env.MQTT_PASSWORD           ?? '',
  mqttTopicPrefix:      process.env.MQTT_TOPIC_PREFIX       ?? 'callattendant',
  mqttNotifyVoicemail:  process.env.MQTT_NOTIFY_VOICEMAIL   !== 'false',
  mqttNotifyBlocked:    process.env.MQTT_NOTIFY_BLOCKED     !== 'false',
  mqttNotifyAll:        process.env.MQTT_NOTIFY_ALL         === 'true',
  robocallCleanupEnabled:  process.env.ROBOCALL_CLEANUP_ENABLED === 'true',
  robocallCleanupCron:     process.env.ROBOCALL_CLEANUP_CRON ?? '0 2 * * 6',
  robocallCleanupUseIpqs:  false,
  dtmfRemovalEnabled: process.env.DTMF_REMOVAL_ENABLED === 'true',
  dtmfRemovalKey:     process.env.DTMF_REMOVAL_KEY ?? '9',
  // ─── Modem crash recovery ──────────────────────────────────────────────────
  // Number of consecutive AT-command timeouts before the modem is declared
  // "wedged" (firmware hang). The watchdog then triggers auto-recovery.
  modemWatchdogTimeouts:    parseInt(process.env.MODEM_WATCHDOG_TIMEOUTS ?? '3', 10),
  // Master switch for automatic recovery (soft reopen + optional USB reset).
  modemAutoRecover:         process.env.MODEM_AUTO_RECOVER !== 'false',
  // Attempt a dependency-free Linux sysfs USB re-enumeration during recovery.
  // No-op on non-Linux and when the sysfs nodes aren't writable (e.g. inside an
  // unprivileged Docker container).
  modemUsbReset:            process.env.MODEM_USB_RESET !== 'false',
  // Optional external command run during recovery (e.g. a uhubctl power cycle or
  // a host-side reset script). Empty = disabled.
  modemResetCmd:            process.env.MODEM_RESET_CMD ?? '',
  // When recovery cannot revive the modem, exit the process so a supervisor
  // (systemd Restart=always / Docker restart: unless-stopped) restarts it.
  // Off by default; the Docker-friendly escape hatch for firmware hangs.
  modemExitOnUnrecoverable: process.env.MODEM_EXIT_ON_UNRECOVERABLE === 'true',
} as const;
