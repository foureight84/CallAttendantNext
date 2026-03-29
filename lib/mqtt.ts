import * as mqttLib from 'mqtt';
import { getSettings } from './db';
import { modemLog } from './events';

export interface CallMqttData {
  action: 'Permitted' | 'Blocked' | 'Screened';
  name: string;
  number: string;
  date: string;
  time: string;
  reason: string;
  voicemailFilename?: string;
}

export async function publishCallMqtt(data: CallMqttData): Promise<void> {
  const s = await getSettings();

  if (!s.mqttEnabled || !s.mqttBrokerUrl) return;

  const shouldPublish =
    s.mqttNotifyAll ||
    (s.mqttNotifyVoicemail && !!data.voicemailFilename) ||
    (s.mqttNotifyBlocked   && data.action === 'Blocked');
  if (!shouldPublish) return;

  const topic = `${s.mqttTopicPrefix}/call`;
  const payload: Record<string, string> = {
    action: data.action,
    name:   data.name,
    number: data.number,
    date:   data.date,
    time:   data.time,
    reason: data.reason,
  };
  if (data.voicemailFilename) payload.voicemail = data.voicemailFilename;

  try {
    const client = await mqttLib.connectAsync(s.mqttBrokerUrl, {
      username: s.mqttUsername || undefined,
      password: s.mqttPassword || undefined,
      connectTimeout: 5000,
    });
    await client.publishAsync(topic, JSON.stringify(payload), { retain: false });
    await client.endAsync();
    modemLog('info', `MQTT published to ${topic} — ${data.action} from ${data.number}`);
  } catch (err) {
    modemLog('error', `MQTT publish failed: ${err}`);
  }
}

export async function testMqttConnection(): Promise<{ ok: boolean; error?: string }> {
  const s = await getSettings();

  if (!s.mqttBrokerUrl) {
    return { ok: false, error: 'Broker URL is required' };
  }

  try {
    const client = await mqttLib.connectAsync(s.mqttBrokerUrl, {
      username: s.mqttUsername || undefined,
      password: s.mqttPassword || undefined,
      connectTimeout: 5000,
    });
    await client.publishAsync(`${s.mqttTopicPrefix}/test`, JSON.stringify({ message: 'Call Attendant MQTT test' }));
    await client.endAsync();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
