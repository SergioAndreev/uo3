import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAssetFiles, loadAssetManifest } from "./check-assets.js";

const ROOT_DIR = resolve(import.meta.dirname, "..");

function createTempAssetRepo(manifestAssets: unknown[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "uo3-assets-test-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(
    join(dir, "assets/ASSET_MANIFEST.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        maxBinaryBytes: 524288,
        assets: manifestAssets,
      },
      null,
      2,
    ),
    "utf8",
  );
  return dir;
}

describe("check-assets legal gate (ADR-002)", () => {
  it("loads valid assets/ASSET_MANIFEST.json from repository root", () => {
    const res = loadAssetManifest(ROOT_DIR);
    expect(res.manifest).not.toBeNull();
    expect(res.manifest?.schemaVersion).toBe(1);
    expect(res.manifest?.maxBinaryBytes).toBe(524288);
  });

  it("blocks map0.mul and tiledata.mul with ERR_PROPRIETARY_UO_ASSET", () => {
    const dir = createTempAssetRepo();
    try {
      writeFileSync(join(dir, "map0.mul"), Buffer.from([1, 2, 3, 4]));
      writeFileSync(join(dir, "tiledata.mul"), Buffer.from([5, 6, 7, 8]));
      const violations = checkAssetFiles(dir, ["map0.mul", "tiledata.mul"]);
      expect(violations).toHaveLength(2);
      expect(violations.every((v) => v.code === "ERR_PROPRIETARY_UO_ASSET")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks renamed binary file containing UOP magic bytes MYP\\0", () => {
    const dir = createTempAssetRepo();
    try {
      writeFileSync(join(dir, "disguised.dat"), Buffer.from([0x4d, 0x59, 0x50, 0x00, 5, 0, 0, 0]));
      const violations = checkAssetFiles(dir, ["disguised.dat"]);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.code).toBe("ERR_PROPRIETARY_UO_ASSET");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks 600 KiB binary with ERR_BINARY_SIZE_LIMIT and undeclared PNG with ERR_UNDECLARED_ASSET", () => {
    const dir = createTempAssetRepo();
    try {
      writeFileSync(join(dir, "huge.bin"), Buffer.alloc(600 * 1024, 0));
      writeFileSync(join(dir, "undeclared.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
      const violations = checkAssetFiles(dir, ["huge.bin", "undeclared.png"]);
      expect(violations.find((v) => v.path === "huge.bin")?.code).toBe("ERR_BINARY_SIZE_LIMIT");
      expect(violations.find((v) => v.path === "undeclared.png")?.code).toBe(
        "ERR_UNDECLARED_ASSET",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows source/doc files with UO-like names (tiledata.ts, map-patch.ts, anim-multi.md)", () => {
    const dir = createTempAssetRepo();
    try {
      mkdirSync(join(dir, "packages/uo-formats/src"), { recursive: true });
      mkdirSync(join(dir, "packages/rules/src/world"), { recursive: true });
      mkdirSync(join(dir, "packages/uo-formats/docs"), { recursive: true });
      writeFileSync(join(dir, "packages/uo-formats/src/tiledata.ts"), "export const x = 1;\n");
      writeFileSync(join(dir, "packages/rules/src/world/map-patch.ts"), "export const y = 2;\n");
      writeFileSync(join(dir, "packages/uo-formats/docs/anim-multi.md"), "# Docs\n");

      const violations = checkAssetFiles(dir, [
        "packages/uo-formats/src/tiledata.ts",
        "packages/rules/src/world/map-patch.ts",
        "packages/uo-formats/docs/anim-multi.md",
      ]);
      expect(violations).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("allows a 12 KiB CC0-1.0 PNG declared in ASSET_MANIFEST.json with matching SHA-256", () => {
    const pngData = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(12 * 1024, 0x42),
    ]);
    const sha256 = createHash("sha256").update(pngData).digest("hex");
    const dir = createTempAssetRepo([
      {
        path: "assets/placeholders/grass.png",
        sha256,
        license: "CC0-1.0",
        source: "synthetic generator",
        addedInPhase: "P02",
      },
    ]);
    try {
      mkdirSync(join(dir, "assets/placeholders"), { recursive: true });
      writeFileSync(join(dir, "assets/placeholders/grass.png"), pngData);
      expect(checkAssetFiles(dir, ["assets/placeholders/grass.png"])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
