import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { and, desc, eq, gte, lte, sql, count as drizzleCount } from 'drizzle-orm';
import { config } from './config';
import * as schema from './schema';
import { callLog, whitelist, blacklist, message, settings } from './schema';

// --- Raw client for schema init only ---
let rawClient: ReturnType<typeof createClient>;
function getRawClient() {
  if (!rawClient) rawClient = createClient({ url: `file:${config.dbPath}` });
  return rawClient;
}

declare global { var __drizzleDb: ReturnType<typeof drizzle<typeof schema>> | undefined; }
globalThis.__drizzleDb ??= drizzle(getRawClient(), { schema });
const db = globalThis.__drizzleDb;

export async function initDb(): Promise<void> {
  await getRawClient().executeMultiple(`
    CREATE TABLE IF NOT EXISTS CallLog (
      CallLogID      INTEGER PRIMARY KEY AUTOINCREMENT,
      Name           TEXT,
      Number         TEXT,
      Date           TEXT,
      Time           TEXT,
      SystemDateTime TEXT,
      Action         TEXT,
      Reason         TEXT
    );
    CREATE TABLE IF NOT EXISTS Whitelist (
      PhoneNo        TEXT PRIMARY KEY,
      Name           TEXT,
      Reason         TEXT,
      SystemDateTime TEXT
    );
    CREATE TABLE IF NOT EXISTS Blacklist (
      PhoneNo        TEXT PRIMARY KEY,
      Name           TEXT,
      Reason         TEXT,
      SystemDateTime TEXT
    );
    CREATE TABLE IF NOT EXISTS Message (
      MessageID      INTEGER PRIMARY KEY AUTOINCREMENT,
      CallLogID      INTEGER REFERENCES CallLog(CallLogID),
      Played         INTEGER DEFAULT 0,
      Filename       TEXT,
      DateTime       TEXT
    );
    CREATE TABLE IF NOT EXISTS Settings (
      Key   TEXT PRIMARY KEY,
      Value TEXT NOT NULL
    );
  `);
  // Idempotent column additions for existing databases.
  // SQLite ALTER TABLE ADD COLUMN only fails if the column already exists — safe to ignore.
  for (const [col, type] of [
    ['LineType',   'TEXT'],
    ['Carrier',    'TEXT'],
    ['City',       'TEXT'],
    ['Region',     'TEXT'],
    ['Country',    'TEXT'],
    ['FraudScore', 'INTEGER'],
    ['RiskFlags',  'TEXT'],
  ] as [string, string][]) {
    await getRawClient().execute(`ALTER TABLE CallLog ADD COLUMN ${col} ${type}`).catch(() => {});
  }

  console.log('[db] Schema initialized');
}

// --- Search helper ---
// Searches the caller ID name, number, and resolved names from Whitelist/Blacklist.
// This handles the common case where CallLog.Name is 'O' (unknown) but the number
// is in the whitelist/blacklist with a real name.
function buildSearchConditions(search: string, nameCol: typeof callLog.name, numberCol: typeof callLog.number) {
  const tokens = search.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  return tokens.map(token => {
    const pattern = '%' + token.toLowerCase().replace(/[%_\\]/g, '') + '%';
    return sql`(
      lower(${nameCol}) LIKE ${pattern}
      OR lower(${numberCol}) LIKE ${pattern}
      OR EXISTS (SELECT 1 FROM Whitelist w WHERE w.PhoneNo = ${numberCol} AND lower(w.Name) LIKE ${pattern})
      OR EXISTS (SELECT 1 FROM Blacklist b WHERE b.PhoneNo = ${numberCol} AND lower(b.Name) LIKE ${pattern})
    )`;
  });
}

// --- CallLog ---
export type CallLogRow = typeof callLog.$inferSelect;

export async function insertCallLog(entry: {
  Name: string | null; Number: string | null; Date: string | null;
  Time: string | null; SystemDateTime: string | null; Action: string | null; Reason: string | null;
  LineType?: string | null; Carrier?: string | null; City?: string | null;
  Region?: string | null; Country?: string | null; FraudScore?: number | null; RiskFlags?: string | null;
}): Promise<number> {
  const [row] = await db.insert(callLog).values({
    name: entry.Name,
    number: entry.Number,
    date: entry.Date,
    time: entry.Time,
    systemDateTime: entry.SystemDateTime,
    action: entry.Action,
    reason: entry.Reason,
    lineType: entry.LineType ?? null,
    carrier: entry.Carrier ?? null,
    city: entry.City ?? null,
    region: entry.Region ?? null,
    country: entry.Country ?? null,
    fraudScore: entry.FraudScore ?? null,
    riskFlags: entry.RiskFlags ?? null,
  }).returning({ callLogId: callLog.callLogId });
  return row!.callLogId;
}

export async function getCallLog(
  limit = 50, offset = 0, search?: string, startDate?: string, endDate?: string
): Promise<CallLogRow[]> {
  const conditions = [];
  if (search)    conditions.push(...buildSearchConditions(search, callLog.name, callLog.number));
  if (startDate) conditions.push(gte(callLog.systemDateTime, startDate));
  if (endDate)   conditions.push(lte(callLog.systemDateTime, endDate));
  return db.select().from(callLog)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(callLog.callLogId))
    .limit(limit).offset(offset);
}

export async function getCallLogCount(search?: string, startDate?: string, endDate?: string): Promise<number> {
  const conditions = [];
  if (search)    conditions.push(...buildSearchConditions(search, callLog.name, callLog.number));
  if (startDate) conditions.push(gte(callLog.systemDateTime, startDate));
  if (endDate)   conditions.push(lte(callLog.systemDateTime, endDate));
  const [row] = await db.select({ count: drizzleCount() }).from(callLog)
    .where(conditions.length ? and(...conditions) : undefined);
  return row?.count ?? 0;
}

export async function getTodayStats() {
  const today = new Date().toLocaleDateString('en-US');
  const rows = await db.select({
    action: callLog.action,
    count: drizzleCount(),
  }).from(callLog).where(eq(callLog.date, today)).groupBy(callLog.action);
  const out = { total: 0, blocked: 0, permitted: 0, screened: 0 };
  for (const row of rows) {
    out.total += row.count;
    if (row.action === 'Blocked')   out.blocked   += row.count;
    if (row.action === 'Permitted') out.permitted += row.count;
    if (row.action === 'Screened')  out.screened  += row.count;
  }
  return out;
}

export async function getCallTrend(days = 7, tzOffset = 0): Promise<{ date: string; total: number; blocked: number; permitted: number }[]> {
  const start = new Date();
  start.setDate(start.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);

  // Shift UTC timestamps to local time before extracting date so calls are
  // bucketed on the correct local calendar day, not the UTC day.
  const modifier = `${tzOffset} minutes`;

  const rows = await db.select({
    date: sql<string>`date(datetime(${callLog.systemDateTime}, ${modifier}))`,
    total: drizzleCount(),
    blocked:   sql<number>`SUM(CASE WHEN ${callLog.action} = 'Blocked'   THEN 1 ELSE 0 END)`,
    permitted: sql<number>`SUM(CASE WHEN ${callLog.action} = 'Permitted' THEN 1 ELSE 0 END)`,
  }).from(callLog)
    .where(gte(callLog.systemDateTime, start.toISOString()))
    .groupBy(sql`date(datetime(${callLog.systemDateTime}, ${modifier}))`)
    .orderBy(sql`date(datetime(${callLog.systemDateTime}, ${modifier}))`);

  const dataMap = new Map(rows.map(r => [r.date, r]));
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    // Use local date parts — start was set to local midnight, so getFullYear/Month/Date
    // give the correct local calendar date regardless of UTC offset.
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const row = dataMap.get(dateStr);
    return { date: dateStr, total: row?.total ?? 0, blocked: row ? Number(row.blocked) : 0, permitted: row ? Number(row.permitted) : 0 };
  });
}

// --- Whitelist / Blacklist ---
export type ListRow = typeof whitelist.$inferSelect;

function buildListConditions(table: typeof whitelist | typeof blacklist, search?: string, startDate?: string, endDate?: string) {
  const conditions = [];
  if (search) {
    const pattern = '%' + search.toLowerCase().replace(/[%_\\]/g, '') + '%';
    conditions.push(sql`(lower(${table.phoneNo}) LIKE ${pattern} OR lower(coalesce(${table.name}, '')) LIKE ${pattern})`);
  }
  if (startDate) conditions.push(gte(table.systemDateTime, startDate));
  if (endDate)   conditions.push(lte(table.systemDateTime, endDate));
  return conditions.length ? and(...conditions) : undefined;
}

export async function getWhitelist(limit = 20, offset = 0, search?: string, startDate?: string, endDate?: string): Promise<ListRow[]> {
  return db.select().from(whitelist)
    .where(buildListConditions(whitelist, search, startDate, endDate))
    .orderBy(desc(whitelist.systemDateTime)).limit(limit).offset(offset);
}

export async function getWhitelistCount(search?: string, startDate?: string, endDate?: string): Promise<number> {
  const [row] = await db.select({ count: drizzleCount() }).from(whitelist)
    .where(buildListConditions(whitelist, search, startDate, endDate));
  return row?.count ?? 0;
}

export async function addToWhitelist(entry: { phoneNo: string; name?: string | null; reason?: string | null; systemDateTime?: string | null }): Promise<void> {
  await db.insert(whitelist).values({
    phoneNo: entry.phoneNo, name: entry.name ?? null,
    reason: entry.reason ?? null, systemDateTime: entry.systemDateTime ?? null,
  }).onConflictDoUpdate({
    target: whitelist.phoneNo,
    set: { name: entry.name ?? null, reason: entry.reason ?? null, systemDateTime: entry.systemDateTime ?? null },
  });
}

export async function removeFromWhitelist(phoneNo: string): Promise<void> {
  await db.delete(whitelist).where(eq(whitelist.phoneNo, phoneNo));
}

export async function isWhitelisted(phoneNo: string): Promise<ListRow | undefined> {
  const [row] = await db.select().from(whitelist).where(eq(whitelist.phoneNo, phoneNo));
  if (row) return row;
  const wildcards = await db.select().from(whitelist).where(sql`${whitelist.phoneNo} LIKE '%*%'`);
  return wildcards.find(w => wildcardMatch(w.phoneNo, phoneNo));
}

export async function getBlacklist(limit = 20, offset = 0, search?: string, startDate?: string, endDate?: string): Promise<ListRow[]> {
  return db.select().from(blacklist)
    .where(buildListConditions(blacklist, search, startDate, endDate))
    .orderBy(desc(blacklist.systemDateTime)).limit(limit).offset(offset);
}

export async function getBlacklistCount(search?: string, startDate?: string, endDate?: string): Promise<number> {
  const [row] = await db.select({ count: drizzleCount() }).from(blacklist)
    .where(buildListConditions(blacklist, search, startDate, endDate));
  return row?.count ?? 0;
}

export async function addToBlacklist(entry: { phoneNo: string; name?: string | null; reason?: string | null; systemDateTime?: string | null }): Promise<void> {
  await db.insert(blacklist).values({
    phoneNo: entry.phoneNo, name: entry.name ?? null,
    reason: entry.reason ?? null, systemDateTime: entry.systemDateTime ?? null,
  }).onConflictDoUpdate({
    target: blacklist.phoneNo,
    set: { name: entry.name ?? null, reason: entry.reason ?? null, systemDateTime: entry.systemDateTime ?? null },
  });
}

export async function removeFromBlacklist(phoneNo: string): Promise<void> {
  await db.delete(blacklist).where(eq(blacklist.phoneNo, phoneNo));
}

export async function isBlacklisted(phoneNo: string): Promise<ListRow | undefined> {
  const [row] = await db.select().from(blacklist).where(eq(blacklist.phoneNo, phoneNo));
  if (row) return row;
  const wildcards = await db.select().from(blacklist).where(sql`${blacklist.phoneNo} LIKE '%*%'`);
  return wildcards.find(w => wildcardMatch(w.phoneNo, phoneNo));
}

function wildcardMatch(pattern: string, value: string): boolean {
  const regex = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return regex.test(value);
}

// --- Messages ---
export type MessageRow = typeof message.$inferSelect & { name?: string | null; number?: string | null };

export interface MessageQuery {
  limit?: number; offset?: number; search?: string; startDate?: string; endDate?: string; unplayedOnly?: boolean;
}

export async function insertMessage(entry: { CallLogID: number | null; Played: number; Filename: string | null; DateTime: string | null }): Promise<number> {
  const [row] = await db.insert(message).values({
    callLogId: entry.CallLogID, played: entry.Played, filename: entry.Filename, dateTime: entry.DateTime,
  }).returning({ messageId: message.messageId });
  return row!.messageId;
}

export async function getMessages(q: MessageQuery = {}): Promise<MessageRow[]> {
  const { limit = 20, offset = 0, search, startDate, endDate, unplayedOnly } = q;
  const conditions = [];
  if (search)       conditions.push(...buildSearchConditions(search, callLog.name, callLog.number));
  if (startDate)    conditions.push(gte(message.dateTime, startDate));
  if (endDate)      conditions.push(lte(message.dateTime, endDate));
  if (unplayedOnly) conditions.push(eq(message.played, 0));
  return db.select({
    messageId: message.messageId, callLogId: message.callLogId, played: message.played,
    filename: message.filename, dateTime: message.dateTime,
    name: callLog.name, number: callLog.number,
  }).from(message)
    .leftJoin(callLog, eq(message.callLogId, callLog.callLogId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(message.messageId))
    .limit(limit).offset(offset);
}

export async function getMessagesCount(q: Pick<MessageQuery, 'search' | 'startDate' | 'endDate' | 'unplayedOnly'> = {}): Promise<number> {
  const { search, startDate, endDate, unplayedOnly } = q;
  const conditions = [];
  if (search)       conditions.push(...buildSearchConditions(search, callLog.name, callLog.number));
  if (startDate)    conditions.push(gte(message.dateTime, startDate));
  if (endDate)      conditions.push(lte(message.dateTime, endDate));
  if (unplayedOnly) conditions.push(eq(message.played, 0));
  const [row] = await db.select({ count: drizzleCount() }).from(message)
    .leftJoin(callLog, eq(message.callLogId, callLog.callLogId))
    .where(conditions.length ? and(...conditions) : undefined);
  return row?.count ?? 0;
}

export async function getTopCallers(limit = 10): Promise<{ number: string; name: string | null; count: number }[]> {
  return db.select({
    number: callLog.number,
    name:   callLog.name,
    count:  drizzleCount(),
  }).from(callLog)
    .where(and(
      sql`${callLog.number} IS NOT NULL`,
      sql`${callLog.action} IN ('Permitted', 'Screened')`,
    ))
    .groupBy(callLog.number)
    .orderBy(desc(drizzleCount()))
    .limit(limit) as Promise<{ number: string; name: string | null; count: number }[]>;
}

export async function getTopBlockedCallers(limit = 10): Promise<{ number: string; name: string | null; count: number }[]> {
  return db.select({
    number: callLog.number,
    name:   callLog.name,
    count:  drizzleCount(),
  }).from(callLog)
    .where(and(sql`${callLog.number} IS NOT NULL`, eq(callLog.action, 'Blocked')))
    .groupBy(callLog.number)
    .orderBy(desc(drizzleCount()))
    .limit(limit) as Promise<{ number: string; name: string | null; count: number }[]>;
}

export async function markMessagePlayed(messageId: number): Promise<boolean> {
  const [row] = await db.select({ played: message.played }).from(message).where(eq(message.messageId, messageId));
  if (!row || row.played === 1) return false;
  await db.update(message).set({ played: 1 }).where(eq(message.messageId, messageId));
  return true;
}

export async function markMessageUnplayed(messageId: number): Promise<boolean> {
  const [row] = await db.select({ played: message.played }).from(message).where(eq(message.messageId, messageId));
  if (!row || row.played === 0) return false;
  await db.update(message).set({ played: 0 }).where(eq(message.messageId, messageId));
  return true;
}

export async function deleteMessage(messageId: number): Promise<MessageRow | undefined> {
  const [row] = await db.select().from(message).where(eq(message.messageId, messageId));
  if (row) await db.delete(message).where(eq(message.messageId, messageId));
  return row;
}

export async function getUnplayedMessageCount(): Promise<number> {
  const [row] = await db.select({ count: drizzleCount() }).from(message).where(eq(message.played, 0));
  return row?.count ?? 0;
}

// --- Settings ---
export interface AppSettings {
  screeningMode: string[];
  blockService: string;
  spamThreshold: number;
  ringsBeforeVm: number;
  ringsBeforeVmScreened: number;
  blocklistAction: number;
  ringsBeforeVmBlocklist: number;
  autoBlockSpam: boolean;
  enableGpio: boolean;
  debugConsole: boolean;
  diagnosticMode: boolean;
  savePcmDebug: boolean;
  greetingVoice: string;
  greetingLengthScale: number;
  logFile: string;
  logMaxBytes: number;
  logKeepFiles: number;
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
  robocallCleanupEnabled:  boolean;
  robocallCleanupCron:     string;
  robocallCleanupUseIpqs:  boolean;
  dtmfRemovalEnabled: boolean;
  dtmfRemovalKey: string;
  wizardCompleted: boolean;
  ipqsApiKey: string;
  ipqsStrictness: number;
  ipqsCountries: string[];
}

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.select().from(settings);
  const map: Record<string, string> = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    screeningMode: map['screeningMode'] ? map['screeningMode'].split(',').map(s => s.trim()) : config.screeningMode,
    blockService:          map['blockService']          ?? config.blockService,
    spamThreshold:         parseInt(map['spamThreshold']         ?? String(config.spamThreshold), 10),
    ringsBeforeVm:         parseInt(map['ringsBeforeVm']         ?? String(config.ringsBeforeVm), 10),
    ringsBeforeVmScreened:  parseInt(map['ringsBeforeVmScreened']  ?? String(config.ringsBeforeVmScreened),  10),
    blocklistAction:        parseInt(map['blocklistAction']         ?? String(config.blocklistAction),         10),
    ringsBeforeVmBlocklist: parseInt(map['ringsBeforeVmBlocklist']  ?? String(config.ringsBeforeVmBlocklist),  10),
    autoBlockSpam:          (map['autoBlockSpam'] ?? String(config.autoBlockSpam)) === 'true',
    enableGpio:             (map['enableGpio']    ?? String(config.enableGpio))    === 'true',
    debugConsole:           (map['debugConsole']    ?? String(config.debugConsole))    === 'true',
    diagnosticMode:         (map['diagnosticMode']  ?? String(config.diagnosticMode))  === 'true',
    savePcmDebug:           (map['savePcmDebug']    ?? String(config.savePcmDebug))    === 'true',
    greetingVoice:          map['greetingVoice']          ?? '',
    greetingLengthScale:    parseFloat(map['greetingLengthScale'] ?? String(config.piperLengthScale)),
    logFile:      map['logFile']      ?? config.logFile,
    logMaxBytes:  parseInt(map['logMaxBytes']  ?? String(config.logMaxBytes),  10),
    logKeepFiles: parseInt(map['logKeepFiles'] ?? String(config.logKeepFiles), 10),
    emailEnabled:         (map['emailEnabled']         ?? String(config.emailEnabled))         === 'true',
    emailHost:             map['emailHost']             ?? config.emailHost,
    emailPort:             parseInt(map['emailPort']   ?? String(config.emailPort), 10),
    emailUser:             map['emailUser']             ?? config.emailUser,
    emailPass:             map['emailPass']             ?? config.emailPass,
    emailFrom:             map['emailFrom']             ?? config.emailFrom,
    emailTo:               map['emailTo']               ?? config.emailTo,
    emailNotifyVoicemail: (map['emailNotifyVoicemail'] ?? String(config.emailNotifyVoicemail)) === 'true',
    emailNotifyBlocked:   (map['emailNotifyBlocked']   ?? String(config.emailNotifyBlocked))   === 'true',
    emailNotifyAll:       (map['emailNotifyAll']       ?? String(config.emailNotifyAll))       === 'true',
    mqttEnabled:          (map['mqttEnabled']          ?? String(config.mqttEnabled))          === 'true',
    mqttBrokerUrl:         map['mqttBrokerUrl']         ?? config.mqttBrokerUrl,
    mqttUsername:          map['mqttUsername']          ?? config.mqttUsername,
    mqttPassword:          map['mqttPassword']          ?? config.mqttPassword,
    mqttTopicPrefix:       map['mqttTopicPrefix']       ?? config.mqttTopicPrefix,
    mqttNotifyVoicemail:  (map['mqttNotifyVoicemail']  ?? String(config.mqttNotifyVoicemail))  === 'true',
    mqttNotifyBlocked:    (map['mqttNotifyBlocked']    ?? String(config.mqttNotifyBlocked))    === 'true',
    mqttNotifyAll:        (map['mqttNotifyAll']        ?? String(config.mqttNotifyAll))        === 'true',
    robocallCleanupEnabled:  (map['robocallCleanupEnabled']  ?? String(config.robocallCleanupEnabled))  === 'true',
    robocallCleanupCron:      map['robocallCleanupCron']     ?? config.robocallCleanupCron,
    robocallCleanupUseIpqs:  (map['robocallCleanupUseIpqs']  ?? String(config.robocallCleanupUseIpqs))  === 'true',
    dtmfRemovalEnabled: (map['dtmfRemovalEnabled'] ?? String(config.dtmfRemovalEnabled)) === 'true',
    dtmfRemovalKey:      map['dtmfRemovalKey']    ?? config.dtmfRemovalKey,
    wizardCompleted:    (map['wizardCompleted']    ?? 'false') === 'true',
    ipqsApiKey:          map['ipqsApiKey']         ?? config.ipqsApiKey,
    ipqsStrictness:      parseInt(map['ipqsStrictness'] ?? String(config.ipqsStrictness), 10),
    ipqsCountries:       map['ipqsCountries'] !== undefined
      ? map['ipqsCountries'].split(',').map(s => s.trim()).filter(Boolean)
      : [],
  };
}

export async function saveSettings(s: Partial<AppSettings>): Promise<void> {
  for (const [key, value] of Object.entries(s)) {
    if (value === undefined) continue;
    const str = Array.isArray(value) ? value.join(',') : String(value);
    await db.insert(settings).values({ key, value: str })
      .onConflictDoUpdate({ target: settings.key, set: { value: str } });
  }
}

export async function seedSettingsFromEnv(): Promise<void> {
  // Only write settings whose env var is explicitly set.
  // Unset env vars stay as-is in the DB so user-configured values survive restarts.
  const e = process.env;
  const seed: Partial<AppSettings> = {};

  if (e.SCREENING_MODE              !== undefined) seed.screeningMode          = config.screeningMode;
  if (e.BLOCK_SERVICE               !== undefined) seed.blockService           = config.blockService;
  if (e.SPAM_THRESHOLD              !== undefined) seed.spamThreshold          = config.spamThreshold;
  if (e.RINGS_BEFORE_VM             !== undefined) seed.ringsBeforeVm          = config.ringsBeforeVm;
  if (e.RINGS_BEFORE_VM_SCREENED    !== undefined) seed.ringsBeforeVmScreened  = config.ringsBeforeVmScreened;
  if (e.BLOCKLIST_ACTION            !== undefined) seed.blocklistAction        = config.blocklistAction;
  if (e.RINGS_BEFORE_VM_BLOCKLIST   !== undefined) seed.ringsBeforeVmBlocklist = config.ringsBeforeVmBlocklist;
  if (e.AUTO_BLOCK_SPAM             !== undefined) seed.autoBlockSpam          = config.autoBlockSpam;
  if (e.ENABLE_GPIO                 !== undefined) seed.enableGpio             = config.enableGpio;
  if (e.DEBUG_CONSOLE               !== undefined) seed.debugConsole           = config.debugConsole;
  if (e.DIAGNOSTIC_MODE             !== undefined) seed.diagnosticMode         = config.diagnosticMode;
  if (e.SAVE_PCM_DEBUG              !== undefined) seed.savePcmDebug           = config.savePcmDebug;
  if (e.ROBOCALL_CLEANUP_ENABLED    !== undefined) seed.robocallCleanupEnabled = config.robocallCleanupEnabled;
  if (e.ROBOCALL_CLEANUP_CRON       !== undefined) seed.robocallCleanupCron    = config.robocallCleanupCron;
  if (e.DTMF_REMOVAL_ENABLED        !== undefined) seed.dtmfRemovalEnabled     = config.dtmfRemovalEnabled;
  if (e.DTMF_REMOVAL_KEY            !== undefined) seed.dtmfRemovalKey         = config.dtmfRemovalKey;
  if (e.IPQS_API_KEY                !== undefined) seed.ipqsApiKey             = config.ipqsApiKey;
  if (e.IPQS_STRICTNESS             !== undefined) seed.ipqsStrictness         = config.ipqsStrictness;
  if (e.IPQS_COUNTRIES              !== undefined) seed.ipqsCountries          = config.ipqsCountries;

  if (Object.keys(seed).length > 0) await saveSettings(seed);
}

export async function getRobocallBlacklist(): Promise<typeof blacklist.$inferSelect[]> {
  const rows = await db.select().from(blacklist).all();
  return rows.filter(r => {
    const reason = r.reason?.toLowerCase() ?? '';
    return reason.includes('robocall')
        || reason.startsWith('ipqs:')
        || reason.startsWith('nomorobo:');
  });
}
