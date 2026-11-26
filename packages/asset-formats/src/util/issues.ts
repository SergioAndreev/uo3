export type Severity = 'error' | 'warning';
export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  /** Ключ записи пакета, если ошибка относится к записи. */
  key?: string;
}
export const error = (code: string, message: string, key?: string): Issue => ({
  code,
  severity: 'error',
  message,
  ...(key === undefined ? {} : { key }),
});
export const warning = (code: string, message: string, key?: string): Issue => ({
  ...error(code, message, key),
  severity: 'warning',
});
