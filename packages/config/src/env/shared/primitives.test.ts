import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
  createSecretSchema,
  createSensitiveUriSchema,
  HttpUrlSchema,
  isSecretProperty,
  isSensitiveUriProperty,
  LogLevelSchema,
  NatsUrlSchema,
  NodeEnvSchema,
  parseStrictBoolean,
  parseStrictInt,
  PositiveTimeoutMsSchema,
  PostgresUrlSchema,
  RedisUrlSchema,
  TcpPortSchema,
  WsUrlSchema,
} from "./primitives.js";

describe("Config shared primitives & TypeBox schemas", () => {
  it("parses strict booleans (true/false/1/0) and rejects ambiguous strings", () => {
    expect(parseStrictBoolean(true)).toBe(true);
    expect(parseStrictBoolean(false)).toBe(false);
    expect(parseStrictBoolean(1)).toBe(true);
    expect(parseStrictBoolean(0)).toBe(false);
    expect(parseStrictBoolean("true")).toBe(true);
    expect(parseStrictBoolean("FALSE")).toBe(false);
    expect(parseStrictBoolean("1")).toBe(true);
    expect(parseStrictBoolean("0")).toBe(false);

    expect(parseStrictBoolean("yes")).toBeUndefined();
    expect(parseStrictBoolean("no")).toBeUndefined();
    expect(parseStrictBoolean("2")).toBeUndefined();
    expect(parseStrictBoolean(2)).toBeUndefined();
    expect(parseStrictBoolean("")).toBeUndefined();
  });

  it("parses strict integers and rejects floats or trailing garbage", () => {
    expect(parseStrictInt("3001")).toBe(3001);
    expect(parseStrictInt("0")).toBe(0);
    expect(parseStrictInt(-5)).toBe(-5);
    expect(parseStrictInt("3.14")).toBeUndefined();
    expect(parseStrictInt("3001px")).toBeUndefined();
    expect(parseStrictInt("")).toBeUndefined();
    expect(parseStrictInt(Number.NaN)).toBeUndefined();
  });

  it("validates TCP ports (1..65535), positive timeouts, log levels, and node envs", () => {
    const port = TcpPortSchema(3001);
    expect(Value.Check(port, 1)).toBe(true);
    expect(Value.Check(port, 65535)).toBe(true);
    expect(Value.Check(port, 0)).toBe(false);
    expect(Value.Check(port, 65536)).toBe(false);

    const timeout = PositiveTimeoutMsSchema(15000);
    expect(Value.Check(timeout, 1)).toBe(true);
    expect(Value.Check(timeout, 0)).toBe(false);
    expect(Value.Check(timeout, -10)).toBe(false);

    const level = LogLevelSchema();
    expect(Value.Check(level, "fatal")).toBe(true);
    expect(Value.Check(level, "trace")).toBe(true);
    expect(Value.Check(level, "verbose")).toBe(false);

    const env = NodeEnvSchema();
    expect(Value.Check(env, "development")).toBe(true);
    expect(Value.Check(env, "production")).toBe(true);
    expect(Value.Check(env, "qa")).toBe(false);
  });

  it("validates protocol-restricted URLs and secret metadata annotations", () => {
    expect(Value.Check(HttpUrlSchema(), "https://api.uo3.local")).toBe(true);
    expect(Value.Check(HttpUrlSchema(), "ftp://api.uo3.local")).toBe(false);

    expect(Value.Check(WsUrlSchema(), "wss://game.uo3.local/ws")).toBe(true);
    expect(Value.Check(WsUrlSchema(), "http://game.uo3.local")).toBe(false);

    expect(Value.Check(PostgresUrlSchema(), "postgresql://uo3:pass@localhost:5432/uo3_dev")).toBe(
      true,
    );
    expect(Value.Check(PostgresUrlSchema(), "mysql://localhost:3306/db")).toBe(false);

    expect(Value.Check(RedisUrlSchema(), "redis://localhost:6379")).toBe(true);
    expect(Value.Check(RedisUrlSchema(), "http://localhost:6379")).toBe(false);

    expect(Value.Check(NatsUrlSchema(), "nats://localhost:4222")).toBe(true);
    expect(Value.Check(NatsUrlSchema(), "tls://localhost:4222")).toBe(true);
    expect(Value.Check(NatsUrlSchema(), "ftp://localhost:4222")).toBe(false);

    const secret = createSecretSchema();
    expect(isSecretProperty(secret)).toBe(true);
    expect(isSensitiveUriProperty(secret)).toBe(false);

    const uri = createSensitiveUriSchema("url-postgres");
    expect(isSensitiveUriProperty(uri)).toBe(true);
    expect(isSecretProperty(uri)).toBe(false);
  });
});
