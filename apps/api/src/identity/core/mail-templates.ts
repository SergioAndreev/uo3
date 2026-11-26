import type { MailMessage } from '../ports.js';

const sign = '\n\n— Duskmarch';

/** Тексты писем; ссылки содержат одноразовые токены. */
export const MAIL = {
  verify: (to: string, link: string): MailMessage => ({
    to,
    subject: 'Duskmarch: подтвердите адрес',
    text: `Чтобы завершить регистрацию, откройте ссылку в течение 24 часов:\n${link}${sign}`,
  }),
  registrationAttempt: (to: string, link: string): MailMessage => ({
    to,
    subject: 'Duskmarch: попытка повторной регистрации',
    text: `Кто-то пытался зарегистрироваться с вашим адресом. Если это вы и забыли пароль, восстановите доступ:\n${link}${sign}`,
  }),
  passwordReset: (to: string, link: string): MailMessage => ({
    to,
    subject: 'Duskmarch: сброс пароля',
    text: `Ссылка для нового пароля действует 30 минут:\n${link}\nЕсли вы не запрашивали сброс, просто проигнорируйте письмо.${sign}`,
  }),
  emailChange: (to: string, link: string): MailMessage => ({
    to,
    subject: 'Duskmarch: подтвердите новый адрес',
    text: `Подтвердите смену адреса в течение 2 часов:\n${link}${sign}`,
  }),
  emailChangeWarning: (to: string): MailMessage => ({
    to,
    subject: 'Duskmarch: запрошена смена адреса',
    text: `Для вашего аккаунта запрошена смена адреса. Если это не вы, смените пароль.${sign}`,
  }),
  emailTaken: (to: string): MailMessage => ({
    to,
    subject: 'Duskmarch: запрос смены адреса',
    text: `Кто-то пытался привязать этот адрес к другому аккаунту. Ничего делать не нужно.${sign}`,
  }),
  notice: (to: string, subject: string, body: string): MailMessage => ({
    to,
    subject: `Duskmarch: ${subject}`,
    text: `${body}${sign}`,
  }),
};
