import { initContract } from '@ts-rest/core';
import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';

const c = initContract();

export const CallLogSchema = z.object({
  callLogId:      z.number(),
  name:           z.string().nullable(),
  number:         z.string().nullable(),
  date:           z.string().nullable(),
  time:           z.string().nullable(),
  systemDateTime: z.string().nullable(),
  action:         z.string().nullable(),
  reason:         z.string().nullable(),
  lineType:       z.string().nullable().optional(),
  carrier:        z.string().nullable().optional(),
  city:           z.string().nullable().optional(),
  region:         z.string().nullable().optional(),
  country:        z.string().nullable().optional(),
  fraudScore:     z.number().nullable().optional(),
  riskFlags:      z.string().nullable().optional(),
});

export const ListEntrySchema = z.object({
  phoneNo:        z.string(),
  name:           z.string().nullable(),
  reason:         z.string().nullable(),
  systemDateTime: z.string().nullable(),
});

export const MessageSchema = z.object({
  messageId:  z.number(),
  callLogId:  z.number().nullable(),
  played:     z.number(),
  filename:   z.string().nullable(),
  dateTime:   z.string().nullable(),
  name:       z.string().nullable(),
  number:     z.string().nullable(),
  hasPcm:     z.boolean(),
});

export const AppSettingsSchema = z.object({
  serialPort:            z.string(),
  serialBaudRate:        z.number(),
  screeningMode:         z.array(z.string()),
  blockService:          z.string(),
  spamThreshold:         z.number(),
  ringsBeforeVm:         z.number(),
  ringsBeforeVmScreened:  z.number(),
  blocklistAction:        z.number(),
  ringsBeforeVmBlocklist: z.number(),
  autoBlockSpam:          z.boolean(),
  enableGpio:             z.boolean(),
  debugConsole:           z.boolean(),
  diagnosticMode:         z.boolean(),
  savePcmDebug:           z.boolean(),
  greetingVoice:          z.string(),
  greetingLengthScale:    z.number(),
  logFile:                z.string(),
  logMaxBytes:            z.number(),
  logKeepFiles:           z.number(),
  emailEnabled:           z.boolean(),
  emailHost:              z.string(),
  emailPort:              z.number(),
  emailUser:              z.string(),
  emailPass:              z.string(),
  emailFrom:              z.string(),
  emailTo:                z.string(),
  emailNotifyVoicemail:   z.boolean(),
  emailNotifyBlocked:     z.boolean(),
  emailNotifyAll:         z.boolean(),
  mqttEnabled:            z.boolean(),
  mqttBrokerUrl:          z.string(),
  mqttUsername:           z.string(),
  mqttPassword:           z.string(),
  mqttTopicPrefix:        z.string(),
  mqttNotifyVoicemail:    z.boolean(),
  mqttNotifyBlocked:      z.boolean(),
  mqttNotifyAll:          z.boolean(),
  robocallCleanupEnabled:  z.boolean(),
  robocallCleanupCron:     z.string().refine(val => { try { CronExpressionParser.parse(val); return true; } catch { return false; } }, { message: 'Invalid cron expression' }),
  robocallCleanupUseIpqs:  z.boolean(),
  dtmfRemovalEnabled:     z.boolean(),
  dtmfRemovalKey:         z.string(),
  wizardCompleted:        z.boolean(),
  ipqsApiKey:             z.string(),
  ipqsStrictness:         z.number(),
});

const OkSchema = z.object({ ok: z.literal(true) });

const DateRangeQuery = {
  startDate: z.string().optional(),
  endDate:   z.string().optional(),
};

export const contract = c.router({
  calls: c.router({
    list: {
      method: 'GET',
      path: '/api/calls',
      query: z.object({
        limit:  z.coerce.number().default(50),
        offset: z.coerce.number().default(0),
        search: z.string().optional(),
        ...DateRangeQuery,
      }),
      responses: { 200: z.object({ rows: z.array(CallLogSchema), total: z.number() }) },
    },
  }),
  whitelist: c.router({
    list:   { method: 'GET',    path: '/api/whitelist', responses: { 200: z.array(ListEntrySchema) } },
    add:    { method: 'POST',   path: '/api/whitelist', body: z.object({ phoneNo: z.string(), name: z.string().optional(), reason: z.string().optional() }), responses: { 200: OkSchema } },
    remove: { method: 'DELETE', path: '/api/whitelist', body: z.object({ phoneNo: z.string() }), responses: { 200: OkSchema } },
  }),
  blacklist: c.router({
    list:   { method: 'GET',    path: '/api/blacklist', responses: { 200: z.array(ListEntrySchema) } },
    add:    { method: 'POST',   path: '/api/blacklist', body: z.object({ phoneNo: z.string(), name: z.string().optional(), reason: z.string().optional() }), responses: { 200: OkSchema } },
    remove: { method: 'DELETE', path: '/api/blacklist', body: z.object({ phoneNo: z.string() }), responses: { 200: OkSchema } },
    cleanupStatus: { method: 'GET',  path: '/api/blacklist/cleanup', responses: { 200: z.object({ running: z.boolean(), pendingCount: z.number() }) } },
    cleanup:       { method: 'POST', path: '/api/blacklist/cleanup', body: z.object({}), responses: { 200: OkSchema } },
  }),
  messages: c.router({
    list: {
      method: 'GET',
      path: '/api/messages',
      query: z.object({
        limit:  z.coerce.number().default(20),
        offset: z.coerce.number().default(0),
        search: z.string().optional(),
        ...DateRangeQuery,
      }),
      responses: { 200: z.object({ messages: z.array(MessageSchema), total: z.number() }) },
    },
    patch: {
      method: 'PATCH',
      path: '/api/messages',
      body: z.object({ messageId: z.number(), played: z.boolean() }),
      responses: { 200: OkSchema },
    },
    delete: {
      method: 'DELETE',
      path: '/api/messages',
      body: z.object({ messageId: z.number() }),
      responses: { 200: OkSchema },
    },
    unread: {
      method: 'GET',
      path: '/api/messages/unread',
      responses: { 200: z.object({ count: z.number() }) },
    },
  }),
  settings: c.router({
    get:  { method: 'GET',  path: '/api/settings', responses: { 200: AppSettingsSchema } },
    save: {
      method: 'POST',
      path: '/api/settings',
      body: AppSettingsSchema.partial().omit({ serialPort: true, serialBaudRate: true }),
      responses: { 200: OkSchema },
    },
    ipqsUsage: {
      method: 'GET',
      path: '/api/settings/ipqs-usage',
      responses: {
        200: z.object({
          success: z.boolean(),
          credits: z.number().optional(),
          usage: z.number().optional(),
          phoneUsage: z.number().optional(),
          exhausted: z.boolean().optional(),
          message: z.string().optional(),
        }),
      },
    },
  }),
});

export type CallLog     = z.infer<typeof CallLogSchema>;
export type ListEntry   = z.infer<typeof ListEntrySchema>;
export type Message     = z.infer<typeof MessageSchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
