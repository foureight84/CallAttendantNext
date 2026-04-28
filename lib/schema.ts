import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const callLog = sqliteTable('CallLog', {
  callLogId:      integer('CallLogID').primaryKey({ autoIncrement: true }),
  name:           text('Name'),
  number:         text('Number'),
  date:           text('Date'),
  time:           text('Time'),
  systemDateTime: text('SystemDateTime'),
  action:         text('Action'),
  reason:         text('Reason'),
  lineType:       text('LineType'),
  carrier:        text('Carrier'),
  city:           text('City'),
  region:         text('Region'),
  country:        text('Country'),
  fraudScore:     integer('FraudScore'),
  riskFlags:      text('RiskFlags'),
});

export const whitelist = sqliteTable('Whitelist', {
  phoneNo:        text('PhoneNo').primaryKey(),
  name:           text('Name'),
  reason:         text('Reason'),
  systemDateTime: text('SystemDateTime'),
});

export const blacklist = sqliteTable('Blacklist', {
  phoneNo:        text('PhoneNo').primaryKey(),
  name:           text('Name'),
  reason:         text('Reason'),
  systemDateTime: text('SystemDateTime'),
});

export const message = sqliteTable('Message', {
  messageId:  integer('MessageID').primaryKey({ autoIncrement: true }),
  callLogId:  integer('CallLogID').references(() => callLog.callLogId),
  played:     integer('Played').notNull().default(0),
  filename:   text('Filename'),
  dateTime:   text('DateTime'),
});

export const settings = sqliteTable('Settings', {
  key:   text('Key').primaryKey(),
  value: text('Value').notNull(),
});
