import { describe, expect, it } from "vitest";
import {
  CONFIG_EXIT_CODE,
  ConfigError,
  ConfigErrorCode,
  formatConfigDiagnosticReport,
} from "./errors.js";

describe("ConfigError and diagnostic formatting", () => {
  it("exposes all 5 canonical ConfigErrorCode values and exit code 78", () => {
    expect(Object.values(ConfigErrorCode).sort()).toEqual([
      "CONFIG_CLIENT_SECRET_FORBIDDEN",
      "CONFIG_CONFLICT",
      "CONFIG_INSECURE_PROD_VALUE",
      "CONFIG_SECRET_FILE_ERROR",
      "CONFIG_VALIDATION_FAILED",
    ]);
    expect(CONFIG_EXIT_CODE).toBe(78);
  });

  it("aggregates multiple issues and formats a structured report", () => {
    const err = new ConfigError(
      [
        {
          code: ConfigErrorCode.CONFIG_VALIDATION_FAILED,
          key: "DATABASE_URL",
          message: "обязательное поле отсутствует",
          expected: "postgres:// или postgresql:// URL",
        },
        {
          code: ConfigErrorCode.CONFIG_VALIDATION_FAILED,
          key: "API_PORT",
          message: "значение вне диапазона",
          expected: "1..65535",
        },
      ],
      "api",
    );

    expect(err.name).toBe("ConfigError");
    expect(err.exitCode).toBe(78);
    expect(err.issues).toHaveLength(2);
    expect(Object.isFrozen(err.issues)).toBe(true);

    const report = err.formatReport();
    expect(report).toContain("[api]");
    expect(report).toContain("DATABASE_URL");
    expect(report).toContain("API_PORT");
    expect(report).toContain("CONFIG_VALIDATION_FAILED");
    expect(formatConfigDiagnosticReport(err.issues, "api")).toBe(report);
  });
});
