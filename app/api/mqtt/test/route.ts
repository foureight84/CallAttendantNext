import { testMqttConnection } from '@/lib/mqtt';

export const dynamic = 'force-dynamic';

export async function POST() {
  const result = await testMqttConnection();
  return Response.json(result, { status: result.ok ? 200 : 400 });
}
