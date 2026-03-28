import { sendTestEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST() {
  const result = await sendTestEmail();
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
