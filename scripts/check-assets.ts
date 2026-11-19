import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type AssetViolationCode =
  | "ERR_PROPRIETARY_UO_ASSET"
  | "ERR_BINARY_SIZE_LIMIT"
  | "ERR_UNDECLARED_ASSET"
  | "ERR_INVALID_MANIFEST";

export interface AssetViolation {
  readonly code: AssetViolationCode;
  readonly path: string;
  readonly message: string;
}

export interface AssetManifestEntry {
  readonly path: string;
  readonly sha256: string;
  readonly license: "CC0-1.0" | "synthetic-generated";
  readonly source: string;
  readonly addedInPhase: string;
}

export interface AssetManifest {
  readonly schemaVersion: 1;
  readonly maxBinaryBytes: number;
  readonly assets: readonly AssetManifestEntry[];
}

const PROPRIETARY_EXTENSIONS = new Set([".mul", ".uop", ".idx", ".def", ".enu"]);

const SOURCE_OR_DOC_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yaml",
  ".yml",
]);

const PROPRIETARY_BASENAME_PATTERNS: readonly RegExp[] = [
  /^tiledata\./i,
  /^verdata\./i,
  /^hues\./i,
  /^cliloc\./i,
  /^art\./i,
  /^anim/i,
  /^map\d*\.mul$/i,
  /^statics\d*\.mul$/i,
  /^staidx\d*\.mul$/i,
  /^multi\./i,
  /^gumpart\./i,
  /^texmaps\./i,
  /^radarcol\./i,
  /^sound\d*\.mul$/i,
];

const BINARY_MEDIA_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".ico",
  ".tga",
  ".dds",
  ".ktx2",
  ".wav",
  ".mp3",
  ".ogg",
  ".flac",
  ".glb",
  ".gltf",
  ".bin",
  ".wasm",
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
  ".zip",
  ".gz",
  ".tar",
]);

const UOP_MAGIC = Buffer.from([0x4d, 0x59, 0x50, 0x00]); // "MYP\0"
const DEFAULT_MAX_BINARY_BYTES = 524_288; // 512 KiB

export function loadAssetManifest(rootDir: string): {
  readonly manifest: AssetManifest | null;
  readonly error?: string;
} {
  const manifestPath = join(rootDir, "assets/ASSET_MANIFEST.json");
  if (!existsSync(manifestPath)) {
    return { manifest: null, error: "Файл assets/ASSET_MANIFEST.json не найден." };
  }
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<AssetManifest>;
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.maxBinaryBytes !== "number" ||
      parsed.maxBinaryBytes <= 0 ||
      parsed.maxBinaryBytes > DEFAULT_MAX_BINARY_BYTES ||
      !Array.isArray(parsed.assets)
    ) {
      return { manifest: null, error: "Некорректная структура assets/ASSET_MANIFEST.json." };
    }
    return { manifest: parsed as AssetManifest };
  } catch (err) {
    return {
      manifest: null,
      error: `Ошибка чтения assets/ASSET_MANIFEST.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function isBinaryBuffer(buf: Buffer): boolean {
  const sampleLen = Math.min(buf.length, 8192);
  for (let i = 0; i < sampleLen; i++) {
    if (buf[i] === 0) {
      return true;
    }
  }
  return false;
}

export function checkAssetFiles(
  rootDir: string,
  relativeFiles: readonly string[],
): readonly AssetViolation[] {
  const { manifest, error } = loadAssetManifest(rootDir);
  if (!manifest) {
    return [
      {
        code: "ERR_INVALID_MANIFEST",
        path: "assets/ASSET_MANIFEST.json",
        message: error ?? "Невалидный манифест ассетов.",
      },
    ];
  }

  const manifestByPath = new Map<string, AssetManifestEntry>();
  for (const entry of manifest.assets) {
    manifestByPath.set(entry.path.replace(/\\/g, "/"), entry);
  }

  const violations: AssetViolation[] = [];

  for (const rawRel of relativeFiles) {
    const relPath = rawRel.replace(/\\/g, "/");
    const fullPath = join(rootDir, relPath);
    if (!existsSync(fullPath)) {
      continue;
    }
    const stat = statSync(fullPath);
    if (!stat.isFile()) {
      continue;
    }

    const base = basename(relPath);
    const ext = extname(relPath).toLowerCase();

    if (PROPRIETARY_EXTENSIONS.has(ext)) {
      violations.push({
        code: "ERR_PROPRIETARY_UO_ASSET",
        path: relPath,
        message: `Запрещённый проприетарный формат Ultima Online (${ext}). См. политику ADR-002 в docs/ARCHITECTURE.md.`,
      });
      continue;
    }

    if (
      !SOURCE_OR_DOC_EXTENSIONS.has(ext) &&
      PROPRIETARY_BASENAME_PATTERNS.some((pattern) => pattern.test(base))
    ) {
      violations.push({
        code: "ERR_PROPRIETARY_UO_ASSET",
        path: relPath,
        message: `Запрещённое имя файла клиента Ultima Online (${base}). См. политику ADR-002 в docs/ARCHITECTURE.md.`,
      });
      continue;
    }

    const content = readFileSync(fullPath);
    const header = content.subarray(0, 16);
    if (header.subarray(0, 4).equals(UOP_MAGIC)) {
      violations.push({
        code: "ERR_PROPRIETARY_UO_ASSET",
        path: relPath,
        message:
          "Обнаружена бинарная сигнатура архива UOP (MYP\\0). Проприетарные архивы UO запрещены (ADR-002).",
      });
      continue;
    }

    const isBinary = BINARY_MEDIA_EXTENSIONS.has(ext) || isBinaryBuffer(content);
    if (!isBinary) {
      continue;
    }

    if (content.byteLength > manifest.maxBinaryBytes) {
      violations.push({
        code: "ERR_BINARY_SIZE_LIMIT",
        path: relPath,
        message: `Размер бинарного файла (${content.byteLength} байт) превышает лимит ${manifest.maxBinaryBytes} байт (512 КиБ).`,
      });
      continue;
    }

    const declared = manifestByPath.get(relPath);
    if (!declared) {
      violations.push({
        code: "ERR_UNDECLARED_ASSET",
        path: relPath,
        message:
          "Бинарный медиа/ассет файл не зарегистрирован в assets/ASSET_MANIFEST.json с лицензией CC0-1.0 или synthetic-generated.",
      });
      continue;
    }

    if (declared.license !== "CC0-1.0" && declared.license !== "synthetic-generated") {
      violations.push({
        code: "ERR_UNDECLARED_ASSET",
        path: relPath,
        message: `Недопустимая лицензия ассета "${String(declared.license)}" (разрешены только CC0-1.0 или synthetic-generated).`,
      });
      continue;
    }

    const actualSha = createHash("sha256").update(content).digest("hex");
    if (actualSha !== declared.sha256.toLowerCase()) {
      violations.push({
        code: "ERR_UNDECLARED_ASSET",
        path: relPath,
        message: `Несовпадение SHA-256 ассета в assets/ASSET_MANIFEST.json (ожидалось ${declared.sha256}, фактически ${actualSha}).`,
      });
    }
  }

  return violations;
}

function collectGitFiles(rootDir: string, staged: boolean): string[] {
  const args = staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACM"]
    : ["ls-files", "--cached", "--others", "--exclude-standard"];
  const res = spawnSync("git", args, { cwd: rootDir, encoding: "utf8" });
  if (res.status !== 0) {
    return [];
  }
  return res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const rootDir = resolve(import.meta.dirname, "..");
  const staged = process.argv.includes("--staged");
  const files = collectGitFiles(rootDir, staged);
  const violations = checkAssetFiles(rootDir, files);

  if (violations.length > 0) {
    process.stderr.write(`Нарушения гейта правовой чистоты ассетов (${violations.length}):\n`);
    for (const v of violations) {
      process.stderr.write(`  - [${v.code}] ${v.path}: ${v.message}\n`);
    }
    process.exit(1);
  }

  process.stdout.write(
    `Проверка правовой чистоты ассетов (ADR-002) пройдена (${files.length} файлов).\n`,
  );
}
