import { describe, expect, it, vi } from "vitest";
import { BOT_CLIENT_VERSION, runBotClientCli } from "./index.js";

describe("@uo3/bot-client unit tests", () => {
  it("prints version and protocol metadata on --version", async () => {
    const out: string[] = [];
    const code = await runBotClientCli(
      ["--version"],
      {},
      { stdout: (m) => out.push(m), loadDotEnv: false },
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toContain(BOT_CLIENT_VERSION);
    expect(out.join("\n")).toContain("protocol=0.0.1");
  });

  it("pings /healthz on target API and returns 0 when HTTP 200", async () => {
    const out: string[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
    const code = await runBotClientCli(
      ["ping-health"],
      {
        NODE_ENV: "development",
        TARGET_API_URL: "http://localhost:3001",
        TARGET_GAME_WS_URL: "ws://localhost:2567",
        BOT_CONCURRENCY: "5",
      },
      { stdout: (m) => out.push(m), stderr: () => undefined, fetchImpl, loadDotEnv: false },
    );
    expect(code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:3001/healthz");
    expect(out.join("\n")).toContain('"status":"ok"');
  });

  it("exits with code 78 when BotClientEnvSchema validation fails", async () => {
    const err: string[] = [];
    const code = await runBotClientCli(
      ["ping-health"],
      {
        NODE_ENV: "development",
        TARGET_API_URL: "ftp://invalid",
        TARGET_GAME_WS_URL: "http://not-ws",
        BOT_CONCURRENCY: "9999",
      },
      { stdout: () => undefined, stderr: (m) => err.push(m), loadDotEnv: false },
    );
    expect(code).toBe(78);
    expect(err.join("\n")).toContain("TARGET_API_URL");
    expect(err.join("\n")).toContain("BOT_CONCURRENCY");
  });

  it("returns non-zero on HTTP error, network error, or unknown CLI flag", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    const failCode = await runBotClientCli(
      ["ping-health"],
      {
        NODE_ENV: "development",
        TARGET_API_URL: "http://localhost:3001",
        TARGET_GAME_WS_URL: "ws://localhost:2567",
      },
      { stdout: () => undefined, stderr: () => undefined, fetchImpl, loadDotEnv: false },
    );
    expect(failCode).toBe(1);

    const errFetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    const netErrCode = await runBotClientCli(
      ["ping-health"],
      {
        NODE_ENV: "development",
        TARGET_API_URL: "http://localhost:3001",
        TARGET_GAME_WS_URL: "ws://localhost:2567",
      },
      { stdout: () => undefined, stderr: () => undefined, fetchImpl: errFetch, loadDotEnv: false },
    );
    expect(netErrCode).toBe(1);

    const unknownCode = await runBotClientCli(
      ["bad-cmd"],
      {},
      { stdout: () => undefined, stderr: () => undefined, loadDotEnv: false },
    );
    expect(unknownCode).toBe(2);

    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      expect(await runBotClientCli([], {}, { loadDotEnv: false })).toBe(0);
      expect(await runBotClientCli(["unknown"], {}, { loadDotEnv: false })).toBe(2);
    } finally {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    }
  });
});
