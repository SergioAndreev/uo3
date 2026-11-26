import type { MailMessage, MailTransport } from '../ports.js';

/** Письма в журнал (только разработка): ссылки из писем видны в консоли. */
export class LogMailTransport implements MailTransport {
  constructor(private readonly write: (line: string) => void = (l) => console.log(l)) {}

  async send(message: MailMessage): Promise<void> {
    this.write(JSON.stringify({ msg: 'identity: письмо', ...message }));
  }
}
