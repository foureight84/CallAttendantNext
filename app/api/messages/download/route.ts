import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { config } from '@/lib/config';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const filename = searchParams.get('filename');
  const number   = searchParams.get('number');

  if (!filename) return NextResponse.json({ error: 'Missing filename' }, { status: 400 });

  // Prevent path traversal
  const safe = path.basename(filename);
  const filePath = path.join(config.messagesDir, safe);

  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const ext = path.extname(safe);
  const base = path.basename(safe, ext);
  const downloadName = number
    ? `${base}_${number.replace(/\D/g, '')}${ext}`
    : safe;

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Disposition': `attachment; filename="${downloadName}"`,
    },
  });
}
