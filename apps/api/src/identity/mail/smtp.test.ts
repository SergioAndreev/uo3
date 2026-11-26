import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TLSSocket, createServer as createTlsServer } from 'node:tls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LogMailTransport } from './log.js';
import { SmtpTransport, buildMessage } from './smtp.js';

let cert: { key: string; cert: string };
let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dm-smtp-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ed25519',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  cert = {
    key: readFileSync(join(dir, 'key.pem'), 'utf8'),
    cert: readFileSync(join(dir, 'cert.pem'), 'utf8'),
  };
});
afterAll(() => rmSync(dir, { recursive: true }));

interface Fake {
  server: Server;
  port: number;
  commands: string[];
  data: string[];
}

/** Поддельный SMTP-сервер; `mode` выбирает TLS. */
async function fakeSmtp(
  mode: 'plain' | 'starttls' | 'implicit',
  { failRcpt = false }: { failRcpt?: boolean } = {},
): Promise<Fake> {
  const fake = { commands: [] as string[], data: [] as string[] } as Fake;
  const serve = (socket: Socket | TLSSocket, secure: boolean, banner = true) => {
    let buffer = '';
    let inData = false;
    let body = '';
    if (banner) socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let i: number;
      while ((i = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            fake.data.push(body);
            socket.write('250 принято\r\n');
          } else body += `${line}\r\n`;
          continue;
        }
        fake.commands.push(line);
        const verb = line.split(' ')[0]?.toUpperCase();
        if (verb === 'EHLO') {
          const tls = mode === 'starttls' && !secure ? '250-STARTTLS\r\n' : '';
          socket.write(`250-fake\r\n${tls}250 AUTH PLAIN\r\n`);
        } else if (verb === 'STARTTLS') {
          socket.write('220 начинаем TLS\r\n');
          socket.removeAllListeners('data');
          const upgraded = new TLSSocket(socket, { isServer: true, ...cert });
          // Баннер 220 после STARTTLS не повторяется.
          serve(upgraded, true, false);
        } else if (verb === 'AUTH') socket.write('235 ok\r\n');
        else if (verb === 'RCPT') socket.write(failRcpt ? '550 нет такого\r\n' : '250 ok\r\n');
        else if (verb === 'DATA') {
          inData = true;
          body = '';
          socket.write('354 жду\r\n');
        } else if (verb === 'QUIT') socket.end('221 пока\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  };
  fake.server =
    mode === 'implicit'
      ? createTlsServer(cert, (s) => serve(s, true))
      : createServer((s) => serve(s, false));
  await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
  fake.port = (fake.server.address() as AddressInfo).port;
  return fake;
}

const message = { to: 'hero@example.com', subject: 'Подтверждение', text: 'Привет, мир' };

describe('SMTP', () => {
  it('обычное соединение с AUTH PLAIN', async () => {
    const fake = await fakeSmtp('plain');
    await new SmtpTransport({
      url: `smtp://user:p%40ss@127.0.0.1:${fake.port}`,
      from: 'Duskmarch <no-reply@duskmarch.invalid>',
    }).send(message);
    fake.server.close();
    expect(fake.commands).toEqual([
      'EHLO duskmarch.local',
      `AUTH PLAIN ${Buffer.from('\0user\0p@ss').toString('base64')}`,
      'MAIL FROM:<no-reply@duskmarch.invalid>',
      'RCPT TO:<hero@example.com>',
      'DATA',
      'QUIT',
    ]);
    const data = fake.data[0] ?? '';
    expect(data).toContain('Subject: =?UTF-8?B?');
    const body = data.split('\r\n\r\n')[1] ?? '';
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString()).toBe('Привет, мир');
  });

  it('STARTTLS и неявный TLS', async () => {
    for (const mode of ['starttls', 'implicit'] as const) {
      const fake = await fakeSmtp(mode);
      const scheme = mode === 'implicit' ? 'smtps' : 'smtp';
      await new SmtpTransport({
        url: `${scheme}://127.0.0.1:${fake.port}`,
        from: 'no-reply@duskmarch.invalid',
        rejectUnauthorized: false,
      }).send(message);
      fake.server.close();
      expect(fake.data).toHaveLength(1);
      if (mode === 'starttls') {
        expect(fake.commands.filter((c) => c.startsWith('EHLO'))).toHaveLength(2);
      }
    }
  });

  it('ошибки: отказ сервера, недоступность, неверная схема, инъекция заголовка', async () => {
    const fake = await fakeSmtp('plain', { failRcpt: true });
    const smtp = new SmtpTransport({ url: `smtp://127.0.0.1:${fake.port}`, from: 'a@b.cd' });
    await expect(smtp.send(message)).rejects.toThrow('ожидался 250');
    fake.server.close();
    await expect(
      new SmtpTransport({ url: `smtp://127.0.0.1:${fake.port}`, from: 'a@b.cd' }).send(message),
    ).rejects.toThrow();
    expect(() => new SmtpTransport({ url: 'http://x', from: 'a@b.cd' })).toThrow('smtp://');
    await expect(smtp.send({ ...message, subject: 'a\r\nBcc: x@y.zz' })).rejects.toThrow(
      'перевод строки',
    );
  });

  it('таймаут ответа', async () => {
    const silent = createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const port = (silent.address() as AddressInfo).port;
    await expect(
      new SmtpTransport({ url: `smtp://127.0.0.1:${port}`, from: 'a@b.cd', timeoutMs: 100 }).send(
        message,
      ),
    ).rejects.toThrow('таймаут');
    silent.close();
  });

  it('формат письма и журнальный транспорт', async () => {
    const text = buildMessage('a@b.cd', { ...message, subject: 'ascii' }, new Date(0), 'id');
    expect(text).toContain('Subject: ascii\r\n');
    expect(text).toContain('Message-ID: <id@duskmarch>');
    const lines: string[] = [];
    await new LogMailTransport((l) => lines.push(l)).send(message);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ to: 'hero@example.com' });
  });
});
