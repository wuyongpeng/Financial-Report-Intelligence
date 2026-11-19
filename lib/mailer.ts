import { connect as tlsConnect } from 'node:tls';
import { connect as netConnect, type Socket } from 'node:net';

export function mailConfigured() {
  return Boolean(process.env.MAIL_WEBHOOK_URL?.trim() || (process.env.SMTP_HOST && process.env.MAIL_FROM));
}

export function publicAppUrl() {
  const raw = process.env.APP_PUBLIC_URL?.trim();
  return raw ? raw.replace(/\/$/, '') : '';
}

export function absoluteAppUrl(pathname: string) {
  const base = publicAppUrl();
  if (!base) return pathname;
  return `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

export type MailInput = { to: string; subject: string; text: string };

/** Best-effort mail. In-app notifications still work if this returns false. */
export async function sendMail(input: MailInput) {
  const webhook = process.env.MAIL_WEBHOOK_URL?.trim();
  if (webhook) {
    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, from: process.env.MAIL_FROM ?? undefined }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`webhook ${response.status}`);
      return true;
    } catch (error) {
      console.error('[mail] webhook failed', error);
      return false;
    }
  }
  if (!process.env.SMTP_HOST || !process.env.MAIL_FROM) return false;
  try {
    await smtpSend(input);
    return true;
  } catch (error) {
    console.error('[mail] smtp failed', error);
    return false;
  }
}

async function smtpSend(input: MailInput) {
  const host = process.env.SMTP_HOST!.trim();
  const port = Number(process.env.SMTP_PORT || '587');
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER?.trim() || '';
  const pass = process.env.SMTP_PASS ?? '';
  const from = process.env.MAIL_FROM!.trim();
  const session = await SmtpSession.connect(host, port, secure);
  try {
    await session.expect([220]);
    await session.command('EHLO eva', [250]);
    if (!secure && session.last.includes('STARTTLS')) {
      await session.command('STARTTLS', [220]);
      await session.upgrade(host);
      await session.command('EHLO eva', [250]);
    }
    if (user) {
      await session.command('AUTH LOGIN', [334]);
      await session.command(Buffer.from(user).toString('base64'), [334]);
      await session.command(Buffer.from(pass).toString('base64'), [235]);
    }
    await session.command(`MAIL FROM:<${envelope(from)}>`, [250]);
    await session.command(`RCPT TO:<${envelope(input.to)}>`, [250, 251]);
    await session.command('DATA', [354]);
    const payload = [
      `From: ${from}`,
      `To: ${input.to}`,
      `Subject: ${encodeSubject(input.subject)}`,
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      input.text,
      '.',
    ].join('\r\n');
    await session.command(payload, [250]);
    await session.command('QUIT', [221, 250]);
  } finally {
    session.close();
  }
}

class SmtpSession {
  last = '';
  private buffer = '';
  private waiting: Array<(line: string) => void> = [];
  private constructor(private socket: Socket) {
    this.bind(socket);
  }

  static connect(host: string, port: number, secure: boolean) {
    return new Promise<SmtpSession>((resolve, reject) => {
      const socket = secure
        ? tlsConnect({ host, port, servername: host }, () => resolve(new SmtpSession(socket)))
        : netConnect({ host, port }, () => resolve(new SmtpSession(socket)));
      socket.setTimeout(15_000, () => socket.destroy(new Error('SMTP timeout')));
      socket.once('error', reject);
    });
  }

  async upgrade(host: string) {
    const current = this.socket;
    const next = await new Promise<Socket>((resolve, reject) => {
      const tlsSocket = tlsConnect({ socket: current, servername: host }, () => resolve(tlsSocket));
      tlsSocket.once('error', reject);
    });
    this.bind(next);
    this.socket = next;
  }

  async command(line: string, ok: number[]) {
    this.socket.write(`${line}\r\n`);
    return this.expect(ok);
  }

  async expect(ok: number[]) {
    let chunk = '';
    for (;;) {
      const line = await this.readLine();
      chunk += line;
      if (/^\d{3} /.test(line)) break;
    }
    this.last = chunk;
    const code = Number(chunk.slice(0, 3));
    if (!ok.includes(code)) throw new Error(`SMTP ${chunk.trim()}`);
    return chunk;
  }

  close() {
    this.socket.end();
  }

  private bind(socket: Socket) {
    this.socket = socket;
    this.buffer = '';
    socket.on('data', (data) => {
      this.buffer += data.toString('utf8');
      this.flush();
    });
  }

  private flush() {
    let index;
    while (this.waiting.length && (index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index + 1);
      this.buffer = this.buffer.slice(index + 1);
      this.waiting.shift()!(line);
    }
  }

  private readLine() {
    return new Promise<string>((resolve) => {
      this.waiting.push(resolve);
      this.flush();
    });
  }
}

function envelope(address: string) {
  const match = address.match(/<([^>]+)>/);
  return (match?.[1] ?? address).trim();
}

function encodeSubject(text: string) {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`;
}
