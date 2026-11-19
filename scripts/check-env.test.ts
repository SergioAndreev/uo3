import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AdminEnvSchema } from "@uo3/config/env/client";
import { describe, expect, it } from "vitest";
import { checkAllEnvParity, checkEnvTargetParity, type EnvTargetSpec } from "./check-env.js";

const ROOT_DIR = resolve(import.meta.dirname, "..");

describe("check-env parity validator", () => {
  it("passes cleanly across all 7 real .env.example templates in the repository", () => {
    const results = checkAllEnvParity(ROOT_DIR);
    expect(results).toHaveLength(7);
    for (const r of results) {
      expect(r.ok, `${r.id}: ${JSON.stringify(r)}`).toBe(true);
    }
  });

  it("detects missing keys, extra stale keys, and duplicate keys in .env.example", () => {
    const dir = mkdtempSync(join(tmpdir(), "uo3-check-env-"));
    try {
      const target: EnvTargetSpec = {
        id: "admin-fixture",
        envExamplePath: ".env.example",
        kind: "client",
        schema: AdminEnvSchema as unknown as EnvTargetSpec["schema"],
      };

      writeFileSync(
        join(dir, ".env.example"),
        "VITE_APP_ENV=development\nVITE_API_BASE_URL=http://localhost:3001\nVITE_LOG_LEVEL=info\n",
        "utf8",
      );
      expect(checkEnvTargetParity(dir, target).ok).toBe(true);

      writeFileSync(
        join(dir, ".env.example"),
        "VITE_APP_ENV=development\nVITE_LOG_LEVEL=info\n",
        "utf8",
      );
      const missingRes = checkEnvTargetParity(dir, target);
      expect(missingRes.ok).toBe(false);
      expect(missingRes.missingInExample).toEqual(["VITE_API_BASE_URL"]);

      writeFileSync(
        join(dir, ".env.example"),
        "VITE_APP_ENV=development\nVITE_API_BASE_URL=http://localhost:3001\nVITE_LOG_LEVEL=info\nVITE_LEGACY_REMOVED=1\n",
        "utf8",
      );
      const extraRes = checkEnvTargetParity(dir, target);
      expect(extraRes.ok).toBe(false);
      expect(extraRes.extraInExample).toEqual(["VITE_LEGACY_REMOVED"]);

      writeFileSync(
        join(dir, ".env.example"),
        "VITE_APP_ENV=development\nVITE_API_BASE_URL=http://localhost:3001\nVITE_LOG_LEVEL=info\nVITE_LOG_LEVEL=debug\n",
        "utf8",
      );
      const dupRes = checkEnvTargetParity(dir, target);
      expect(dupRes.ok).toBe(false);
      expect(dupRes.duplicateKeys).toEqual(["VITE_LOG_LEVEL"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
