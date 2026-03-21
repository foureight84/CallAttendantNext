import { initContract } from '@ts-rest/core';
import { z } from 'zod';

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
  greetingVoice:          z.string(),
  greetingLengthScale:    z.number(),
  logFile:                z.string(),
  logMaxBytes:            z.number(),
  logKeepFiles:           z.number(),
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
  }),
});

export type CallLog     = z.infer<typeof CallLogSchema>;
export type ListEntry   = z.infer<typeof ListEntrySchema>;
export type Message     = z.infer<typeof MessageSchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
