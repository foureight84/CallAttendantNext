import { NextRequest, NextResponse } from 'next/server';
import {
  getCallLog, getCallLogCount, getCallTrend, getTopCallers, getTopBlockedCallers,
  getWhitelist, addToWhitelist, removeFromWhitelist,
  getBlacklist, addToBlacklist, removeFromBlacklist,
  getMessages, getMessagesCount, markMessagePlayed, markMessageUnplayed, deleteMessage, getUnplayedMessageCount,
  getSettings, saveSettings,
} from '@/lib/db';
import { callEvents, updateLogConfig } from '@/lib/events';
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
    return json(await getCallTrend(days));
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
    return json(await getWhitelist());
  }

  if (route === 'blacklist') {
    return json(await getBlacklist());
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
    return json({ messages, total });
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
