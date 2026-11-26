import type { EventPublisher, MailMessage, MailTransport } from '../ports.js';

/** Почтовый ящик для тестов; может имитировать сбой доставки. */
export class MemoryMailbox implements MailTransport {
  readonly sent: MailMessage[] = [];
  failing = false;

  async send(message: MailMessage): Promise<void> {
    if (this.failing) throw new Error('почтовый сервер недоступен');
    this.sent.push(message);
  }

  /** Письма адресату. */
  to(address: string): MailMessage[] {
    return this.sent.filter((m) => m.to === address);
  }

  /** Последний токен из ссылки `…?token=…` в письме адресату. */
  lastToken(address: string): string | undefined {
    const text = this.to(address).at(-1)?.text ?? '';
    return /token=([A-Za-z0-9_-]+)/.exec(text)?.[1];
  }
}

export class MemoryEvents implements EventPublisher {
  readonly published: { subject: string; payload: unknown }[] = [];

  async publish(subject: string, payload: unknown): Promise<void> {
    this.published.push({ subject, payload });
  }

  of(subject: string): unknown[] {
    return this.published.filter((e) => e.subject === subject).map((e) => e.payload);
  }
}
