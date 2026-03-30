import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { getSettings } from './db';
import { modemLog } from './events';
import { config } from './config';

export interface CallEmailData {
  action: 'Permitted' | 'Blocked' | 'Screened';
  name: string;
  number: string;
  date: string;
  time: string;
  systemDateTime: string;
  reason: string;
  voicemailFilename?: string; // basename of the MP3, relative to messagesDir
}

function buildTransport(host: string, port: number, user: string, pass: string) {
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function buildSubject(data: CallEmailData): string {
  const label = data.action === 'Blocked' ? 'Blocked call' :
                data.action === 'Permitted' ? 'Voicemail' : 'Screened call';
  const caller = data.name !== 'UNKNOWN' ? `${data.name} (${data.number})` : data.number;
  return `[Call Attendant] ${label} from ${caller}`;
}

function buildBody(data: CallEmailData): string {
  const lines = [
    `Call Attendant Notification`,
    ``,
    `Date/Time : ${data.date} ${data.time}`,
    `Caller    : ${data.name !== 'UNKNOWN' ? data.name : '—'} <${data.number}>`,
    `Action    : ${data.action}`,
    `Reason    : ${data.reason}`,
  ];
  if (data.voicemailFilename) {
    lines.push(`Voicemail : ${data.voicemailFilename} (attached)`);
  }
  return lines.join('\n');
}

export async function sendCallEmail(data: CallEmailData): Promise<void> {
  const s = await getSettings();

  if (!s.emailEnabled || !s.emailHost || !s.emailUser || !s.emailPass || !s.emailTo) return;

  // Send if any enabled notification condition matches.
  const shouldSend =
    s.emailNotifyAll ||
    (s.emailNotifyVoicemail && !!data.voicemailFilename) ||
    (s.emailNotifyBlocked  && data.action === 'Blocked');
  if (!shouldSend) return;

  const from = s.emailFrom || s.emailUser;
  const transport = buildTransport(s.emailHost, s.emailPort, s.emailUser, s.emailPass);

  const mailOptions: nodemailer.SendMailOptions = {
    from,
    to: s.emailTo,
    subject: buildSubject(data),
    text: buildBody(data),
  };

  // Attach voicemail MP3 if present and file exists
  if (data.voicemailFilename) {
    const fullPath = path.join(path.resolve(config.messagesDir), path.basename(data.voicemailFilename));
    if (fs.existsSync(fullPath)) {
      mailOptions.attachments = [{
        filename: path.basename(data.voicemailFilename),
        path: fullPath,
      }];
    }
  }

  try {
    await transport.sendMail(mailOptions);
    modemLog('info', `Email sent to ${s.emailTo} — ${buildSubject(data)}`);
  } catch (err) {
    modemLog('error', `Failed to send email: ${err}`);
  }
}

export async function sendTestEmail(): Promise<{ ok: boolean; error?: string }> {
  const s = await getSettings();

  if (!s.emailHost || !s.emailUser || !s.emailPass || !s.emailTo) {
    return { ok: false, error: 'SMTP settings incomplete' };
  }

  const from = s.emailFrom || s.emailUser;
  const transport = buildTransport(s.emailHost, s.emailPort, s.emailUser, s.emailPass);

  try {
    await transport.sendMail({
      from,
      to: s.emailTo,
      subject: '[Call Attendant] Test email',
      text: 'Your Call Attendant email notifications are working correctly.',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
