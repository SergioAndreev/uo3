import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';

export const PASSWORD_MIN = 12;

/** Сообщение об ошибке API для игрока (без раскрытия существования аккаунта). */
export function messageOf(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Нет связи с сервером. Повторите попытку.';
  switch (error.code) {
    case 'AUTH_INVALID_CREDENTIALS':
      return 'Неверный email или пароль';
    case 'AUTH_EMAIL_NOT_VERIFIED':
      return 'Email не подтверждён: проверьте почту';
    case 'TFA_INVALID_CODE':
    case 'TFA_CODE_REPLAYED':
      return 'Неверный код';
    case 'REG_WEAK_PASSWORD':
      return 'Пароль не подходит под правила';
    case 'REG_INVALID_EMAIL':
    case 'REG_EMAIL_DOMAIN_BLOCKED':
      return 'Этот email нельзя использовать';
    case 'REG_TOS_VERSION_OUTDATED':
      return 'Документы обновились: обновите страницу';
    default:
      return error.status === 429 ? 'Слишком много попыток' : 'Не удалось выполнить запрос';
  }
}

/** Обратный отсчёт в секундах (`Retry-After`, повторная отправка письма). */
export function useCountdown(): [number, (seconds: number) => void] {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((v) => v - 1), 1_000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft];
}

export const formatLeft = (s: number): string =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export interface AuthBody {
  status: string;
  accessToken?: string;
  expiresIn?: number;
  mfaChallengeToken?: string;
  oauthOnboardingToken?: string;
  tosVersion?: string;
  privacyVersion?: string;
}

export interface Documents {
  tosVersion: string;
  privacyVersion: string;
  oauthProviders: string[];
}
