import { NextRequest, NextResponse } from 'next/server';
import { getDiagnosticState, startDiagnostic, resetDiagnostic } from '@/lib/diagnostic';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getDiagnosticState());
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { action?: string };
  if (body.action === 'start') {
    return NextResponse.json(startDiagnostic());
  }
  if (body.action === 'reset') {
    return NextResponse.json(resetDiagnostic());
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
