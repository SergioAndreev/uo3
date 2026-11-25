export const ConfigErrorCode = {
  VALIDATION_FAILED: 'CONFIG_VALIDATION_FAILED',
  CONFLICT: 'CONFIG_CONFLICT',
  SECRET_FILE_ERROR: 'CONFIG_SECRET_FILE_ERROR',
  CLIENT_SECRET_FORBIDDEN: 'CONFIG_CLIENT_SECRET_FORBIDDEN',
  INSECURE_PROD_VALUE: 'CONFIG_INSECURE_PROD_VALUE',
} as const;
export type ConfigErrorCode = (typeof ConfigErrorCode)[keyof typeof ConfigErrorCode];

export interface ConfigIssue {
  code: ConfigErrorCode;
  key: string;
  /** Не содержит исходных значений секретов. */
  message: string;
}

export function formatIssues(issues: readonly ConfigIssue[]): string {
  const lines = issues.map((issue) => `  - [${issue.code}] ${issue.key}: ${issue.message}`);
  return [`Некорректная конфигурация, ошибок: ${issues.length}`, ...lines].join('\n');
}

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(formatIssues(issues));
    this.name = 'ConfigError';
    this.issues = issues;
  }
}
