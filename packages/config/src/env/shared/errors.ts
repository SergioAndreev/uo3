export const ConfigErrorCode = {
  CONFIG_VALIDATION_FAILED: "CONFIG_VALIDATION_FAILED",
  CONFIG_CONFLICT: "CONFIG_CONFLICT",
  CONFIG_SECRET_FILE_ERROR: "CONFIG_SECRET_FILE_ERROR",
  CONFIG_CLIENT_SECRET_FORBIDDEN: "CONFIG_CLIENT_SECRET_FORBIDDEN",
  CONFIG_INSECURE_PROD_VALUE: "CONFIG_INSECURE_PROD_VALUE",
} as const;

export type ConfigErrorCode = (typeof ConfigErrorCode)[keyof typeof ConfigErrorCode];

export const CONFIG_EXIT_CODE = 78 as const;

export interface ConfigIssue {
  readonly code: ConfigErrorCode;
  readonly key: string;
  readonly message: string;
  readonly expected?: string;
}

export function formatConfigDiagnosticReport(
  issues: readonly ConfigIssue[],
  appName = "uo3-app",
): string {
  const header = `[${appName}] Ошибка валидации конфигурации (${issues.length}):`;
  const lines = issues.map((issue) => {
    const suffix = issue.expected !== undefined ? ` (ожидается: ${issue.expected})` : "";
    return `  - [${issue.code}] ${issue.key}: ${issue.message}${suffix}`;
  });
  return [header, ...lines].join("\n");
}

export class ConfigError extends Error {
  public readonly issues: readonly ConfigIssue[];
  public readonly exitCode: number = CONFIG_EXIT_CODE;
  public readonly appName: string;

  public constructor(issues: readonly ConfigIssue[], appName = "uo3-app") {
    const report = formatConfigDiagnosticReport(issues, appName);
    super(report);
    this.name = "ConfigError";
    this.issues = Object.freeze([...issues]);
    this.appName = appName;
  }

  public formatReport(): string {
    return formatConfigDiagnosticReport(this.issues, this.appName);
  }
}
