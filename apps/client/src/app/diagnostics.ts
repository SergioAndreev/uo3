const PATTERNS: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]'],
  [/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu, '[REDACTED]'],
  [/[A-Za-z]:\\(?:[^\\\s"']+\\)*[^\\\s"']*/g, '[REDACTED]'],
  [/(?:\/home|\/Users)\/[^\s"']+/g, '[REDACTED]'],
  [/([?&](?:token|code|state|password)=)[^&\s]+/gi, '$1[REDACTED]'],
];

/** Удаление токенов, email, путей ОС и секретных параметров из текста диагностики. */
export function sanitize(text: string): string {
  return PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), text);
}

export interface DiagnosticReport {
  correlationId: string;
  clientVersion: string;
  route: string;
  errorType: string;
  message: string;
  at: string;
}

export function diagnosticReport(
  error: unknown,
  ctx: { route: string; clientVersion: string; correlationId?: string; now?: Date },
): DiagnosticReport {
  const e = error instanceof Error ? error : new Error(String(error));
  return {
    correlationId: ctx.correlationId ?? crypto.randomUUID(),
    clientVersion: ctx.clientVersion,
    route: sanitize(ctx.route.split('?')[0] ?? ctx.route),
    errorType: e.name,
    message: sanitize(e.message),
    at: (ctx.now ?? new Date()).toISOString(),
  };
}

export const reportText = (r: DiagnosticReport): string =>
  [
    `Duskmarch ${r.clientVersion}`,
    `correlationId: ${r.correlationId}`,
    `маршрут: ${r.route}`,
    `ошибка: ${r.errorType}: ${r.message}`,
    `время: ${r.at}`,
  ].join('\n');
