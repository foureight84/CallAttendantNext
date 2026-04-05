import { NextRequest, NextResponse } from 'next/server';
import {
  getCallLog, getCallLogCount, getCallTrend, getTopCallers, getTopBlockedCallers,
  getWhitelist, getWhitelistCount, addToWhitelist, removeFromWhitelist,
  getBlacklist, getBlacklistCount, addToBlacklist, removeFromBlacklist,
  getMessages, getMessagesCount, markMessagePlayed, markMessageUnplayed, deleteMessage, getUnplayedMessageCount,
  getSettings, saveSettings, getRobocallBlacklist,
} from '@/lib/db';
import { callEvents, updateLogConfig } from '@/lib/events';
import { existsSync } from 'fs';
import { unlink, readdir } from 'fs/promises';
import path from 'path';
import { config } from '@/lib/config';

function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const route = slug?.join('/') ?? '';
  const { searchParams } = req.nextUrl;

  if (route === 'calls/trend') {
    const days = Number(searchParams.get('days') ?? 7);
    const tzOffset = Number(searchParams.get('tzOffset') ?? 0) || 0;
    return json(await getCallTrend(days, tzOffset));
  }

  if (route === 'calls/top') {
    const [callers, blocked] = await Promise.all([getTopCallers(10), getTopBlockedCallers(10)]);
    return json({ callers, blocked });
  }

  if (route === 'calls') {
    const limit  = Number(searchParams.get('limit')  ?? 50);
    const offset = Number(searchParams.get('offset') ?? 0);
    const search    = searchParams.get('search')    ?? undefined;
    const startDate = searchParams.get('startDate') ?? undefined;
    const endDate   = searchParams.get('endDate')   ?? undefined;
    const [rows, total] = await Promise.all([
      getCallLog(limit, offset, search, startDate, endDate),
      getCallLogCount(search, startDate, endDate),
    ]);
    return json({ rows, total });
  }

  if (route === 'whitelist') {
    const limit     = Number(searchParams.get('limit')  ?? 20);
    const offset    = Number(searchParams.get('offset') ?? 0);
    const search    = searchParams.get('search')    ?? undefined;
    const startDate = searchParams.get('startDate') ?? undefined;
    const endDate   = searchParams.get('endDate')   ?? undefined;
    const [rows, total] = await Promise.all([getWhitelist(limit, offset, search, startDate, endDate), getWhitelistCount(search, startDate, endDate)]);
    return json({ rows, total });
  }

  if (route === 'blacklist/cleanup') {
    const { isCleanupRunning } = await import('@/lib/modem/robocallCleanup');
    const entries = await getRobocallBlacklist();
    return json({ running: isCleanupRunning(), pendingCount: entries.length });
  }

  if (route === 'blacklist') {
    const limit     = Number(searchParams.get('limit')  ?? 20);
    const offset    = Number(searchParams.get('offset') ?? 0);
    const search    = searchParams.get('search')    ?? undefined;
    const startDate = searchParams.get('startDate') ?? undefined;
    const endDate   = searchParams.get('endDate')   ?? undefined;
    const [rows, total] = await Promise.all([getBlacklist(limit, offset, search, startDate, endDate), getBlacklistCount(search, startDate, endDate)]);
    return json({ rows, total });
  }

  if (route === 'messages') {
    const limit  = Number(searchParams.get('limit')  ?? 20);
    const offset = Number(searchParams.get('offset') ?? 0);
    const search      = searchParams.get('search')       ?? undefined;
    const startDate   = searchParams.get('startDate')    ?? undefined;
    const endDate     = searchParams.get('endDate')      ?? undefined;
    const unplayedOnly = searchParams.get('unplayedOnly') === 'true';
    const [messages, total] = await Promise.all([
      getMessages({ limit, offset, search, startDate, endDate, unplayedOnly }),
      getMessagesCount({ search, startDate, endDate, unplayedOnly }),
    ]);
    const messagesWithPcm = messages.map(m => ({
      ...m,
      hasPcm: !!m.filename && existsSync(
        path.join(config.messagesDir, path.basename(m.filename).replace(/\.[^.]+$/, '.pcm'))
      ),
    }));
    return json({ messages: messagesWithPcm, total });
  }

  if (route === 'messages/unread') {
    return json({ count: await getUnplayedMessageCount() });
  }

  if (route === 'settings') {
    const s = await getSettings();
    return json({ serialPort: config.serialPort, serialBaudRate: config.serialBaudRate, ...s });
  }

  if (route === 'piper/models') {
    const dir = path.resolve(config.piperModelsDir);
    const files = await readdir(dir).catch(() => []);
    const models = files.filter(f => f.endsWith('.onnx'));
    return json(models);
  }

  return json({ error: 'Not found' }, 404);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const route = slug?.join('/') ?? '';

  if (route === 'blacklist/cleanup') {
    const { runRobocallCleanup } = await import('@/lib/modem/robocallCleanup');
    runRobocallCleanup().catch(() => {});
    return json({ ok: true });
  }

  const body = await req.json();

  if (route === 'whitelist') {
    await addToWhitelist({ ...body, systemDateTime: new Date().toISOString() });
    return json({ ok: true });
  }

  if (route === 'blacklist') {
    await addToBlacklist({ ...body, systemDateTime: new Date().toISOString() });
    return json({ ok: true });
  }

  if (route === 'settings') {
    await saveSettings(body);
    const saved = await getSettings();
    updateLogConfig({ logFile: saved.logFile, logMaxBytes: saved.logMaxBytes, logKeepFiles: saved.logKeepFiles });
    const { rescheduleRobocallCleanup } = await import('@/lib/modem/robocallCleanup');
    rescheduleRobocallCleanup();
    return json({ ok: true });
  }

  if (route === 'piper/preview') {
    const { model, text, lengthScale } = body as { model: string; text: string; lengthScale?: number };
    const modelPath = path.join(path.resolve(config.piperModelsDir), model);
    const { synthesizeWav } = await import('@/lib/modem/tts');
    const stream = synthesizeWav(text, modelPath, lengthScale ?? 1.0);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return new NextResponse(Buffer.concat(chunks), {
      headers: { 'Content-Type': 'audio/wav' },
    });
  }

  return json({ error: 'Not found' }, 404);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const route = slug?.join('/') ?? '';
  const body = await req.json();

  if (route === 'messages') {
    if (body.played) {
      const changed = await markMessagePlayed(body.messageId);
      if (changed) callEvents.emit('voicemail-played');
    } else {
      const changed = await markMessageUnplayed(body.messageId);
      if (changed) callEvents.emit('voicemail-new');
    }
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const route = slug?.join('/') ?? '';
  const body = await req.json();

  if (route === 'whitelist') {
    await removeFromWhitelist(body.phoneNo);
    return json({ ok: true });
  }

  if (route === 'blacklist') {
    await removeFromBlacklist(body.phoneNo);
    return json({ ok: true });
  }

  if (route === 'messages') {
    const msg = await deleteMessage(body.messageId);
    if (msg?.filename) {
      await unlink(path.join(config.messagesDir, msg.filename)).catch(() => {});
    }
    return json({ ok: true });
  }

  return json({ error: 'Not found' }, 404);
}
