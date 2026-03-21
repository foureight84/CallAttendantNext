#!/usr/bin/env npx tsx
/**
 * migrate-from-python.ts
 *
 * Migrates call log, whitelist, blacklist, and voicemail records from the
 * original Python callattendant SQLite database to the new callattendantnext DB.
 *
 * Usage:
 *   npx tsx scripts/migrate-from-python.ts \
 *     --old-db /path/to/callattendant.db \
 *     --old-messages /path/to/messages \
 *     [--new-db /path/to/new/callattendant.db] \
 *     [--new-messages /path/to/new/messages] \
 *     [--dry-run]
 */

import { createClient } from '@libsql/client';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, basename } from 'path';

// --- Parse CLI args ---
const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

const oldDbPath     = getArg('--old-db');
const oldMessagesDir = getArg('--old-messages');
const newDbPath     = getArg('--new-db')       ?? './callattendant.db';
const newMessagesDir = getArg('--new-messages') ?? './messages';
const dryRun        = args.includes('--dry-run');

if (!oldDbPath) {
  console.error('Error: --old-db is required');
  console.error('Usage: npx tsx scripts/migrate-from-python.ts --old-db <path> --old-messages <path> [--dry-run]');
  process.exit(1);
}

if (!existsSync(oldDbPath)) {
  console.error(`Error: old database not found: ${oldDbPath}`);
  process.exit(1);
}

if (dryRun) {
  console.log('[dry-run] No changes will be written.\n');
}

// --- Open databases ---
const oldDb = createClient({ url: `file:${oldDbPath}` });
const newDb = dryRun ? null : createClient({ url: `file:${newDbPath}` });

// --- Ensure new DB tables exist ---
if (!dryRun && newDb) {
  await newDb.executeMultiple(`
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
}

// --- Migration counters ---
const counts = {
  whitelist: { read: 0, inserted: 0 },
  blacklist: { read: 0, inserted: 0 },
  callLog:   { read: 0, inserted: 0 },
  message:   { read: 0, inserted: 0 },
  files:     { copied: 0, skipped: 0, missing: 0 },
};

// --- Migrate Whitelist ---
console.log('Migrating Whitelist...');
try {
  const rows = await oldDb.execute('SELECT PhoneNo, Name, Reason, SystemDateTime FROM Whitelist');
  counts.whitelist.read = rows.rows.length;
  for (const row of rows.rows) {
    if (!dryRun && newDb) {
      try {
        await newDb.execute({
          sql: 'INSERT OR IGNORE INTO Whitelist (PhoneNo, Name, Reason, SystemDateTime) VALUES (?, ?, ?, ?)',
          args: [row[0] ?? null, row[1] ?? null, row[2] ?? null, row[3] ?? null],
        });
        counts.whitelist.inserted++;
      } catch (err) {
        console.warn(`  [warn] Whitelist row ${row[0]}: ${err}`);
      }
    } else {
      counts.whitelist.inserted++;
    }
  }
} catch (err) {
  console.warn(`  [warn] Could not read Whitelist: ${err}`);
}
console.log(`  ${counts.whitelist.read} read, ${counts.whitelist.inserted} inserted`);

// --- Migrate Blacklist ---
console.log('Migrating Blacklist...');
try {
  const rows = await oldDb.execute('SELECT PhoneNo, Name, Reason, SystemDateTime FROM Blacklist');
  counts.blacklist.read = rows.rows.length;
  for (const row of rows.rows) {
    if (!dryRun && newDb) {
      try {
        await newDb.execute({
          sql: 'INSERT OR IGNORE INTO Blacklist (PhoneNo, Name, Reason, SystemDateTime) VALUES (?, ?, ?, ?)',
          args: [row[0] ?? null, row[1] ?? null, row[2] ?? null, row[3] ?? null],
        });
        counts.blacklist.inserted++;
      } catch (err) {
        console.warn(`  [warn] Blacklist row ${row[0]}: ${err}`);
      }
    } else {
      counts.blacklist.inserted++;
    }
  }
} catch (err) {
  console.warn(`  [warn] Could not read Blacklist: ${err}`);
}
console.log(`  ${counts.blacklist.read} read, ${counts.blacklist.inserted} inserted`);

// --- Helpers ---

const MONTH_MAP: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/**
 * Converts a Python callattendant Date value (DD-Mon, e.g. "16-Mar") to our
 * format (MM/DD/YYYY). Uses the year from the accompanying SystemDateTime.
 * Returns the value unchanged if it doesn't match the old pattern.
 */
function normalizeDate(date: string | null, systemDateTime: string | null): string | null {
  if (!date) return date;
  const match = date.match(/^(\d{2})-([A-Za-z]{3})$/);
  if (!match) return date;
  const year = systemDateTime?.slice(0, 4);
  if (!year || !/^\d{4}$/.test(year)) return date;
  const dd = match[1];
  const mm = MONTH_MAP[match[2]!] ?? MONTH_MAP[match[2]!.charAt(0).toUpperCase() + match[2]!.slice(1).toLowerCase()];
  if (!mm) return date;
  return `${mm}/${dd}/${year}`;
}

// --- Migrate CallLog ---
// We need to map old CallLogID → new CallLogID for the Message foreign keys.
const callLogIdMap = new Map<number, number>();

console.log('Migrating CallLog...');
try {
  const rows = await oldDb.execute(
    'SELECT CallLogID, Name, Number, Date, Time, SystemDateTime, Action, Reason FROM CallLog ORDER BY CallLogID'
  );
  counts.callLog.read = rows.rows.length;
  for (const row of rows.rows) {
    const oldId = row[0] as number;
    const date  = normalizeDate(row[3] as string | null, row[5] as string | null);
    if (!dryRun && newDb) {
      try {
        // Check if a row with this CallLogID already exists
        const existing = await newDb.execute({
          sql: 'SELECT CallLogID FROM CallLog WHERE CallLogID = ?',
          args: [oldId],
        });
        if (existing.rows.length > 0) {
          // Already present — map it to itself
          callLogIdMap.set(oldId, oldId);
        } else {
          // Insert with explicit ID to preserve foreign key relationships
          await newDb.execute({
            sql: `INSERT OR IGNORE INTO CallLog (CallLogID, Name, Number, Date, Time, SystemDateTime, Action, Reason)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [oldId, row[1] ?? null, row[2] ?? null, date, row[4] ?? null, row[5] ?? null, row[6] ?? null, row[7] ?? null],
          });
          callLogIdMap.set(oldId, oldId);
          counts.callLog.inserted++;
        }
      } catch (err) {
        console.warn(`  [warn] CallLog row ${oldId}: ${err}`);
      }
    } else {
      callLogIdMap.set(oldId, oldId);
      counts.callLog.inserted++;
    }
  }
} catch (err) {
  console.warn(`  [warn] Could not read CallLog: ${err}`);
}
console.log(`  ${counts.callLog.read} read, ${counts.callLog.inserted} inserted`);

// --- Migrate Message ---
console.log('Migrating Message...');
try {
  const rows = await oldDb.execute(
    'SELECT MessageID, CallLogID, Played, Filename, DateTime FROM Message ORDER BY MessageID'
  );
  counts.message.read = rows.rows.length;
  for (const row of rows.rows) {
    const oldMsgId  = row[0] as number;
    const oldCallId = row[1] as number | null;
    const newCallId = oldCallId != null ? (callLogIdMap.get(oldCallId) ?? oldCallId) : null;
    if (!dryRun && newDb) {
      try {
        const existing = await newDb.execute({
          sql: 'SELECT MessageID FROM Message WHERE MessageID = ?',
          args: [oldMsgId],
        });
        if (existing.rows.length === 0) {
          await newDb.execute({
            sql: `INSERT OR IGNORE INTO Message (MessageID, CallLogID, Played, Filename, DateTime)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [oldMsgId, newCallId, row[2] ?? 0, row[3] ?? null, row[4] ?? null],
          });
          counts.message.inserted++;
        }
      } catch (err) {
        console.warn(`  [warn] Message row ${oldMsgId}: ${err}`);
      }
    } else {
      counts.message.inserted++;
    }
  }
} catch (err) {
  console.warn(`  [warn] Could not read Message: ${err}`);
}
console.log(`  ${counts.message.read} read, ${counts.message.inserted} inserted`);

// --- Copy voicemail files ---
if (oldMessagesDir) {
  console.log('Copying voicemail files...');
  if (!existsSync(oldMessagesDir)) {
    console.warn(`  [warn] --old-messages directory not found: ${oldMessagesDir}`);
  } else {
    if (!dryRun && !existsSync(newMessagesDir)) {
      mkdirSync(newMessagesDir, { recursive: true });
    }
    let files: string[];
    try {
      files = readdirSync(oldMessagesDir);
    } catch (err) {
      files = [];
      console.warn(`  [warn] Could not read old messages dir: ${err}`);
    }
    for (const file of files) {
      const src  = join(oldMessagesDir, file);
      const dest = join(newMessagesDir, basename(file));
      if (existsSync(dest)) {
        counts.files.skipped++;
        continue;
      }
      if (!dryRun) {
        try {
          copyFileSync(src, dest);
          counts.files.copied++;
        } catch (err) {
          console.warn(`  [warn] Could not copy ${file}: ${err}`);
          counts.files.missing++;
        }
      } else {
        counts.files.copied++;
      }
    }
    console.log(`  ${counts.files.copied} copied, ${counts.files.skipped} skipped, ${counts.files.missing} errors`);
  }
} else {
  console.log('Skipping file copy (--old-messages not provided)');
}

// --- Summary ---
console.log('\n=== Migration Summary ===');
if (dryRun) console.log('(DRY RUN — nothing was written)');
console.log(`Whitelist : ${counts.whitelist.inserted} / ${counts.whitelist.read} rows`);
console.log(`Blacklist : ${counts.blacklist.inserted} / ${counts.blacklist.read} rows`);
console.log(`CallLog   : ${counts.callLog.inserted} / ${counts.callLog.read} rows`);
console.log(`Message   : ${counts.message.inserted} / ${counts.message.read} rows`);
if (oldMessagesDir) {
  console.log(`Files     : ${counts.files.copied} copied, ${counts.files.skipped} already present`);
}
console.log('Done.');
