import { pathToFileURL } from "node:url";

export interface NodeVersionCheckResult {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly detectedVersion: string;
  readonly requiredRange: string;
  readonly message: string;
}

export const REQUIRED_NODE_RANGE = ">=22.0.0 <23.0.0";
export const REQUIRED_NODE_MAJOR = 22;

export function parseSemverMajorMinorPatch(
  rawVersion: string,
): { readonly major: number; readonly minor: number; readonly patch: number } | null {
  const cleaned = rawVersion.trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(cleaned);
  if (match === null) {
    return null;
  }

  const majorStr = match[1];
  const minorStr = match[2];
  const patchStr = match[3];
  if (majorStr === undefined || minorStr === undefined || patchStr === undefined) {
    return null;
  }

  return {
    major: Number.parseInt(majorStr, 10),
    minor: Number.parseInt(minorStr, 10),
    patch: Number.parseInt(patchStr, 10),
  };
}

export function checkNodeVersion(
  rawVersion: string = process.versions.node,
): NodeVersionCheckResult {
  const parsed = parseSemverMajorMinorPatch(rawVersion);
  const normalized = rawVersion.trim().replace(/^v/i, "");

  if (parsed === null) {
    return {
      ok: false,
      exitCode: 1,
      detectedVersion: normalized,
      requiredRange: REQUIRED_NODE_RANGE,
      message: `Не удалось распознать версию Node.js "${rawVersion}". Требуется диапазон 22.x (${REQUIRED_NODE_RANGE}).`,
    };
  }

  if (parsed.major !== REQUIRED_NODE_MAJOR) {
    return {
      ok: false,
      exitCode: 1,
      detectedVersion: normalized,
      requiredRange: REQUIRED_NODE_RANGE,
      message: `Несовместимая версия Node.js: обнаружена v${normalized}, требуется 22.x (${REQUIRED_NODE_RANGE}). Установите Node.js 22 LTS (например, через fnm/nvm согласно .nvmrc).`,
    };
  }

  return {
    ok: true,
    exitCode: 0,
    detectedVersion: normalized,
    requiredRange: REQUIRED_NODE_RANGE,
    message: `Node.js v${normalized} соответствует требованиям (${REQUIRED_NODE_RANGE}).`,
  };
}

export function runNodeVersionPreflight(
  rawVersion: string = process.versions.node,
  io: {
    readonly stdout?: (msg: string) => void;
    readonly stderr?: (msg: string) => void;
  } = {},
): number {
  const result = checkNodeVersion(rawVersion);
  const out = io.stdout ?? ((msg: string) => process.stdout.write(`${msg}\n`));
  const err = io.stderr ?? ((msg: string) => process.stderr.write(`${msg}\n`));

  if (result.ok) {
    out(result.message);
  } else {
    err(result.message);
  }
  return result.exitCode;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const overrideVersion = process.env["UO3_SIMULATED_NODE_VERSION"];
  const code = runNodeVersionPreflight(overrideVersion ?? process.versions.node);
  process.exit(code);
}
