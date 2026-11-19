import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = resolve(import.meta.dirname, "..");
const DEPCRUISE_CONFIG = join(ROOT_DIR, ".dependency-cruiser.mjs");

function runDepcruiseFixture(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "uo3-boundaries-fixture-"));
  try {
    copyFileSync(DEPCRUISE_CONFIG, join(dir, ".dependency-cruiser.mjs"));
    for (const [relPath, content] of Object.entries(files)) {
      const fullPath = join(dir, relPath);
      mkdirSync(resolve(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, content, "utf8");
    }

    const targets: string[] = [];
    if (Object.keys(files).some((f) => f.startsWith("apps/"))) {
      targets.push("apps");
    }
    if (Object.keys(files).some((f) => f.startsWith("packages/"))) {
      targets.push("packages");
    }

    const depcruiseBin = join(
      ROOT_DIR,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "depcruise.cmd" : "depcruise",
    );

    return spawnSync(depcruiseBin, ["--config", join(dir, ".dependency-cruiser.mjs"), ...targets], {
      cwd: dir,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("check:boundaries (dependency-cruiser architectural DAG)", () => {
  it("passes cleanly on the real monorepo", () => {
    const res = spawnSync("pnpm", ["check:boundaries"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    expect(res.status, res.stderr || res.stdout).toBe(0);
  });

  it("blocks circular dependencies (domain -> rules -> domain)", () => {
    const res = runDepcruiseFixture({
      "packages/domain/src/index.ts":
        "import { rule } from '../../rules/src/index.js'; export const d = rule;\n",
      "packages/rules/src/index.ts":
        "import { d } from '../../domain/src/index.js'; export const rule = d;\n",
    });
    expect(res.status).not.toBe(0);
    expect(`${res.stdout}\n${res.stderr}`).toContain("no-circular");
  });

  it("blocks @uo3/db import in apps/client and apps/bot-client", () => {
    const clientRes = runDepcruiseFixture({
      "packages/db/src/index.ts": "export const db = 1;\n",
      "apps/client/src/index.ts":
        "import { db } from '../../../packages/db/src/index.js'; export const x = db;\n",
    });
    expect(clientRes.status).not.toBe(0);
    expect(`${clientRes.stdout}\n${clientRes.stderr}`).toContain("no-server-or-node-in-browser");

    const botRes = runDepcruiseFixture({
      "packages/db/src/index.ts": "export const db = 1;\n",
      "apps/bot-client/src/index.ts":
        "import { db } from '../../../packages/db/src/index.js'; export const x = db;\n",
    });
    expect(botRes.status).not.toBe(0);
    expect(`${botRes.stdout}\n${botRes.stderr}`).toContain("no-db-in-cli-or-bot");
  });

  it("blocks @uo3/ui-kit import in apps/api", () => {
    const res = runDepcruiseFixture({
      "packages/ui-kit/src/index.ts": "export const ui = 1;\n",
      "apps/api/src/index.ts":
        "import { ui } from '../../../packages/ui-kit/src/index.js'; export const x = ui;\n",
    });
    expect(res.status).not.toBe(0);
    expect(`${res.stdout}\n${res.stderr}`).toContain("no-browser-ui-in-server");
  });

  it("blocks node:fs import in packages/domain", () => {
    const res = runDepcruiseFixture({
      "packages/domain/src/index.ts": "import fs from 'node:fs'; export const f = fs;\n",
    });
    expect(res.status).not.toBe(0);
    expect(`${res.stdout}\n${res.stderr}`).toContain("no-node-builtins-in-isomorphic-core");
  });

  it("blocks @uo3/test-kit in production src/index.ts while allowing it in *.test.ts", () => {
    const badRes = runDepcruiseFixture({
      "packages/test-kit/src/index.ts": "export const helper = 1;\n",
      "apps/game-server/src/index.ts":
        "import { helper } from '../../../packages/test-kit/src/index.js'; export const x = helper;\n",
    });
    expect(badRes.status).not.toBe(0);
    expect(`${badRes.stdout}\n${badRes.stderr}`).toContain("no-test-kit-in-production");

    const okRes = runDepcruiseFixture({
      "packages/test-kit/src/index.ts": "export const helper = 1;\n",
      "apps/game-server/src/index.test.ts":
        "import { helper } from '../../../packages/test-kit/src/index.js'; export const x = helper;\n",
    });
    expect(okRes.status, okRes.stderr || okRes.stdout).toBe(0);
  });
});
