import { randomUUID } from 'node:crypto';
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import type { MailMessage, MailTransport } from '../ports.js';

export interface SmtpOptions {
  /** `smtp://user:pass@host:port` (STARTTLS, если сервер его предлагает) или `smtps://…`. */
  url: string;
  from: string;
  timeoutMs?: number;
  /** Имя для EHLO. */
  hostname?: string;
  /** Только для тестов с самоподписанным сертификатом. */
  rejectUnauthorized?: boolean;
}

class SmtpError extends Error {
  override readonly name = 'SmtpError';
}

/** Чтение ответов SMTP построчно, многострочные ответы склеиваются. */
class Conversation {
  private buffer = '';
  private waiting: ((line: string) => void) | undefined;
  private readonly lines: string[] = [];
  private failure: Error | undefined;

  constructor(
    public socket: Socket | TLSSocket,
    private readonly timeoutMs: number,
  ) {
    this.listen(socket);
  }

  /** Переход на TLS после STARTTLS: старый поток больше не читается. */
  attach(socket: TLSSocket): void {
    this.socket.removeAllListeners('data');
    this.buffer = '';
    this.socket = socket;
    this.listen(socket);
  }

  private listen(socket: Socket | TLSSocket): void {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let index: number;
      while ((index = this.buffer.indexOf('\r\n')) >= 0) {
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        if (this.waiting) {
          const resolve = this.waiting;
          this.waiting = undefined;
          resolve(line);
        } else this.lines.push(line);
      }
    });
    socket.on('error', (error) => (this.failure = error));
  }

  private nextLine(): Promise<string> {
    if (this.failure) return Promise.reject(this.failure);
    const queued = this.lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new SmtpError('SMTP: таймаут ответа')), this.timeoutMs);
      this.waiting = (line) => {
        clearTimeout(timer);
        resolve(line);
      };
    });
  }

  async reply(expect: number): Promise<string[]> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.nextLine();
      lines.push(line.slice(4));
      if (line[3] !== '-') {
        const code = Number(line.slice(0, 3));
        if (code !== expect) throw new SmtpError(`SMTP: ожидался ${expect}, получено «${line}»`);
        return lines;
      }
    }
  }

  async command(text: string, expect: number): Promise<string[]> {
    this.socket.write(`${text}\r\n`);
    return this.reply(expect);
  }
}

const encodeHeader = (value: string): string =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;

const address = (value: string): string => /<([^>]+)>/.exec(value)?.[1] ?? value.trim();

/** Текст письма в base64 строками по 76 символов. */
export function buildMessage(from: string, message: MailMessage, now: Date, id: string): string {
  const body = Buffer.from(message.text, 'utf8')
    .toString('base64')
    .replace(/.{1,76}/g, '$&\r\n');
  return [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${id}@duskmarch>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n');
}

/** Минимальный SMTP-клиент: EHLO, STARTTLS, AUTH PLAIN, одно письмо на соединение. */
export class SmtpTransport implements MailTransport {
  private readonly url: URL;

  constructor(private readonly options: SmtpOptions) {
    this.url = new URL(options.url);
    if (!['smtp:', 'smtps:'].includes(this.url.protocol)) {
      throw new SmtpError('MAIL_SMTP_URL: ожидается smtp:// или smtps://');
    }
  }

  async send(message: MailMessage): Promise<void> {
    if (/[\r\n]/.test(message.to + message.subject))
      throw new SmtpError('SMTP: перевод строки в заголовке');
    const implicit = this.url.protocol === 'smtps:';
    const port = Number(this.url.port || (implicit ? 465 : 25));
    const host = this.url.hostname;
    const tls = { rejectUnauthorized: this.options.rejectUnauthorized ?? true, servername: host };
    const timeout = this.options.timeoutMs ?? 10_000;
    const socket = await new Promise<Socket | TLSSocket>((resolve, reject) => {
      const s = implicit
        ? tlsConnect({ host, port, ...tls }, () => resolve(s))
        : netConnect({ host, port }, () => resolve(s));
      s.once('error', reject);
      s.setTimeout(timeout, () => s.destroy(new SmtpError('SMTP: таймаут соединения')));
    });
    const talk = new Conversation(socket, timeout);
    const helo = this.options.hostname ?? 'duskmarch.local';
    try {
      await talk.reply(220);
      let features = await talk.command(`EHLO ${helo}`, 250);
      if (!implicit && features.some((f) => f.toUpperCase() === 'STARTTLS')) {
        await talk.command('STARTTLS', 220);
        const secure = await new Promise<TLSSocket>((resolve, reject) => {
          const s = tlsConnect({ socket, ...tls }, () => resolve(s));
          s.once('error', reject);
        });
        talk.attach(secure);
        features = await talk.command(`EHLO ${helo}`, 250);
      }
      if (this.url.username) {
        const user = decodeURIComponent(this.url.username);
        const pass = decodeURIComponent(this.url.password);
        const token = Buffer.from(`\0${user}\0${pass}`).toString('base64');
        await talk.command(`AUTH PLAIN ${token}`, 235);
      }
      await talk.command(`MAIL FROM:<${address(this.options.from)}>`, 250);
      await talk.command(`RCPT TO:<${address(message.to)}>`, 250);
      await talk.command('DATA', 354);
      const text = buildMessage(this.options.from, message, new Date(), randomUUID());
      await talk.command(`${text}\r\n.`, 250);
      await talk.command('QUIT', 221).catch(() => undefined);
    } finally {
      talk.socket.destroy();
    }
  }
}
