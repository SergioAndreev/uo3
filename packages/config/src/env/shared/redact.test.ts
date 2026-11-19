import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { createSecretSchema, PostgresUrlSchema } from "./primitives.js";
import { redactConfig, REDACTED_INVALID_URI, REDACTED_VALUE, redactUri } from "./redact.js";

describe("redactConfig and redactUri", () => {
  it("masks password in URI while preserving scheme, user, host, port and path", () => {
    const masked = redactUri("postgresql://uo3:s3cr3tPass@localhost:5432/uo3_dev");
    expect(masked).toBe("postgresql://uo3:[REDACTED]@localhost:5432/uo3_dev");
    expect(masked).not.toContain("s3cr3tPass");
  });

  it("keeps passwordless URI intact and masks invalid URI without leaking raw text", () => {
    expect(redactUri("nats://localhost:4222")).toBe("nats://localhost:4222");
    const bad = redactUri("not-a-valid-uri-with-s3cr3tPass");
    expect(bad).toBe(REDACTED_INVALID_URI);
    expect(bad).not.toContain("s3cr3tPass");
  });

  it("redacts secret fields and sensitive URIs according to TypeBox schema metadata", () => {
    const Schema = Type.Object({
      API_PORT: Type.Integer(),
      DATABASE_URL: PostgresUrlSchema(),
      JWT_SECRET: createSecretSchema(),
      OPTIONAL_SECRET: Type.Optional(createSecretSchema()),
    });

    const sanitized = redactConfig(Schema, {
      API_PORT: 3001,
      DATABASE_URL: "postgresql://uo3:s3cr3tPass@localhost:5432/uo3_dev",
      JWT_SECRET: "super-secret-signing-key-value",
      OPTIONAL_SECRET: undefined,
    });

    expect(sanitized).toEqual({
      API_PORT: 3001,
      DATABASE_URL: "postgresql://uo3:[REDACTED]@localhost:5432/uo3_dev",
      JWT_SECRET: REDACTED_VALUE,
    });
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("s3cr3tPass");
    expect(serialized).not.toContain("super-secret-signing-key-value");
  });
});
