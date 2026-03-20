import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';
import { config } from '@/lib/config';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  // Prevent path traversal
  const safe = path.basename(filename);
  const filePath = path.join(config.messagesDir, safe);

  try {
    const data = await readFile(filePath);
    return new Response(data, {
      headers: {
        'Content-Type': safe.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav',
        'Content-Length': String(data.length),
        'Accept-Ranges': 'bytes',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
