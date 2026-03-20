import { readLogHistory } from '@/lib/events';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lines = Math.max(1, parseInt(searchParams.get('lines') ?? '2000', 10));
  const entries = readLogHistory(lines);
  return Response.json(entries);
}
