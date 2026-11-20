import { deepFreeze, DomainError, DomainErrorCode, type DeepReadonly } from "@uo3/domain";
import { canonicalJsonStringify } from "../digest/canonical-json.js";
import { sha256Hex } from "../digest/sha256.js";
import { getRulesetPreset } from "../profiles/presets.js";
import {
  KNOWN_FEATURE_FLAG_KEYS,
  KNOWN_OVERRIDE_SECTION_KEYS,
  KNOWN_SECTION_FIELD_KEYS,
  RulesetProfileValidator,
  ShardRulesetOverrideValidator,
  type RulesetProfile,
  type ShardRulesetOverride,
} from "../schema/ruleset.schema.js";

export type RulesetEnvironment = "production" | "staging" | "development" | "test";

export interface RulesetValidationIssue {
  readonly fieldPath: string;
  readonly message: string;
}

export interface ResolvedRulesetProfile extends RulesetProfile {
  readonly profileDigest: string;
}

export interface ResolveRulesetOptions {
  readonly preset?: string;
  readonly overrides?: unknown;
  readonly environment?: RulesetEnvironment;
}

export interface RawShardRulesetConfigFile {
  readonly preset?: unknown;
  readonly environment?: unknown;
  readonly overrides?: unknown;
}

function assertNoUnknownKeys(rawOverrides: unknown): ShardRulesetOverride {
  if (rawOverrides === undefined || rawOverrides === null) {
    return {};
  }
  if (typeof rawOverrides !== "object" || Array.isArray(rawOverrides)) {
    throw new DomainError(
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
      "Shard ruleset overrides must be a plain object",
      { fieldPath: "overrides" },
    );
  }

  const record = rawOverrides as Record<string, unknown>;
  for (const sectionKey of Object.keys(record)) {
    if (!KNOWN_OVERRIDE_SECTION_KEYS.has(sectionKey)) {
      throw new DomainError(
        DomainErrorCode.ERR_RULESET_UNKNOWN_KEY,
        `Unknown ruleset override key: "${sectionKey}"`,
        { fieldPath: sectionKey, details: { key: sectionKey } },
      );
    }

    const sectionValue = record[sectionKey];
    if (sectionValue === undefined) {
      continue;
    }
    if (typeof sectionValue !== "object" || sectionValue === null || Array.isArray(sectionValue)) {
      throw new DomainError(
        DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
        `Ruleset section "${sectionKey}" must be a plain object`,
        { fieldPath: sectionKey },
      );
    }

    const allowedKeys = KNOWN_SECTION_FIELD_KEYS[sectionKey]!;
    for (const fieldKey of Object.keys(sectionValue as Record<string, unknown>)) {
      if (sectionKey === "features" && !KNOWN_FEATURE_FLAG_KEYS.has(fieldKey)) {
        throw new DomainError(
          DomainErrorCode.ERR_UNKNOWN_FEATURE_FLAG,
          `Unknown feature flag: "${fieldKey}"`,
          { fieldPath: `features.${fieldKey}`, details: { flag: fieldKey } },
        );
      }
      if (!allowedKeys.has(fieldKey)) {
        throw new DomainError(
          DomainErrorCode.ERR_RULESET_UNKNOWN_KEY,
          `Unknown ruleset key: "${sectionKey}.${fieldKey}"`,
          {
            fieldPath: `${sectionKey}.${fieldKey}`,
            details: { section: sectionKey, key: fieldKey },
          },
        );
      }
    }
  }

  if (!ShardRulesetOverrideValidator.Check(rawOverrides)) {
    const issues: RulesetValidationIssue[] = [];
    for (const err of ShardRulesetOverrideValidator.Errors(rawOverrides)) {
      issues.push({
        fieldPath: err.path.replace(/^\//, "").replace(/\//g, ".") || "overrides",
        message: err.message,
      });
    }
    throw new DomainError(
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
      `Invalid shard ruleset override types (${String(issues.length)} error(s))`,
      {
        ...(issues[0] !== undefined ? { fieldPath: issues[0].fieldPath } : {}),
        details: { issues },
      },
    );
  }

  return rawOverrides;
}

function mergeProfile(
  base: DeepReadonly<RulesetProfile>,
  overrides: ShardRulesetOverride,
): RulesetProfile {
  return {
    meta: { ...base.meta },
    features: { ...base.features, ...overrides.features },
    geometry: { ...base.geometry, ...overrides.geometry },
    network: { ...base.network, ...overrides.network },
    movement: { ...base.movement, ...overrides.movement },
    time: { ...base.time, ...overrides.time },
    character: {
      ...base.character,
      ...overrides.character,
      enabledRaces: overrides.character?.enabledRaces
        ? [...overrides.character.enabledRaces]
        : [...base.character.enabledRaces],
    },
    inventory: { ...base.inventory, ...overrides.inventory },
    pvp: { ...base.pvp, ...overrides.pvp },
    speech: { ...base.speech, ...overrides.speech },
    lifecycle: { ...base.lifecycle, ...overrides.lifecycle },
    internal: { ...base.internal, ...overrides.internal },
  };
}

export function validateRulesetInvariants(
  profile: RulesetProfile,
): readonly RulesetValidationIssue[] {
  const issues: RulesetValidationIssue[] = [];

  // 1. Numeric range checks
  if (profile.network.aoiRadiusTiles < 10 || profile.network.aoiRadiusTiles > 24) {
    issues.push({
      fieldPath: "network.aoiRadiusTiles",
      message: `aoiRadiusTiles must be in [10, 24], got ${String(profile.network.aoiRadiusTiles)}`,
    });
  }
  if (profile.network.multiAoiRadiusTiles < 18 || profile.network.multiAoiRadiusTiles > 48) {
    issues.push({
      fieldPath: "network.multiAoiRadiusTiles",
      message: `multiAoiRadiusTiles must be in [18, 48], got ${String(profile.network.multiAoiRadiusTiles)}`,
    });
  }
  if (profile.network.simTickMs < 20 || profile.network.simTickMs > 100) {
    issues.push({
      fieldPath: "network.simTickMs",
      message: `simTickMs must be in [20, 100], got ${String(profile.network.simTickMs)}`,
    });
  }

  for (const key of ["walkFootMs", "runFootMs", "walkMountedMs", "runMountedMs"] as const) {
    if (profile.movement[key] < 50) {
      issues.push({
        fieldPath: `movement.${key}`,
        message: `${key} must be >= 50 ms, got ${String(profile.movement[key])}`,
      });
    }
  }

  if (profile.time.gameHourRealMs < 1000) {
    issues.push({
      fieldPath: "time.gameHourRealMs",
      message: `gameHourRealMs must be >= 1000 ms, got ${String(profile.time.gameHourRealMs)}`,
    });
  }
  if (profile.character.statCap < 30 || profile.character.statCap > 900) {
    issues.push({
      fieldPath: "character.statCap",
      message: `statCap must be in [30, 900], got ${String(profile.character.statCap)}`,
    });
  }
  if (profile.character.skillCapTenths < 1000 || profile.character.skillCapTenths > 50_000) {
    issues.push({
      fieldPath: "character.skillCapTenths",
      message: `skillCapTenths must be in [1000, 50000], got ${String(profile.character.skillCapTenths)}`,
    });
  }

  // 2. Cross-field invariants
  if (profile.network.multiAoiRadiusTiles < profile.network.aoiRadiusTiles) {
    issues.push({
      fieldPath: "network.multiAoiRadiusTiles",
      message: "multiAoiRadiusTiles must be >= aoiRadiusTiles",
    });
  }

  const { walkFootMs, runFootMs, walkMountedMs, runMountedMs } = profile.movement;
  if (!(runMountedMs <= runFootMs && runFootMs <= walkFootMs)) {
    issues.push({
      fieldPath: "movement.runFootMs",
      message: `Movement delays must satisfy runMountedMs (${String(runMountedMs)}) <= runFootMs (${String(runFootMs)}) <= walkFootMs (${String(walkFootMs)})`,
    });
  }
  if (!(runMountedMs <= walkMountedMs && walkMountedMs <= walkFootMs)) {
    issues.push({
      fieldPath: "movement.walkMountedMs",
      message: `Movement delays must satisfy runMountedMs (${String(runMountedMs)}) <= walkMountedMs (${String(walkMountedMs)}) <= walkFootMs (${String(walkFootMs)})`,
    });
  }

  const minCap = profile.character.minSingleStat * 3;
  const maxCap = profile.character.maxSingleStat * 3;
  if (profile.character.statCap < minCap || profile.character.statCap > maxCap) {
    issues.push({
      fieldPath: "character.statCap",
      message: `statCap (${String(profile.character.statCap)}) must satisfy minSingleStat*3 (${String(minCap)}) <= statCap <= maxSingleStat*3 (${String(maxCap)})`,
    });
  }

  if (profile.character.maxSingleSkillTenths > profile.character.skillCapTenths) {
    issues.push({
      fieldPath: "character.maxSingleSkillTenths",
      message: `maxSingleSkillTenths (${String(profile.character.maxSingleSkillTenths)}) must be <= skillCapTenths (${String(profile.character.skillCapTenths)})`,
    });
  }

  const { whisperRangeTiles, normalRangeTiles, yellRangeTiles } = profile.speech;
  if (!(
    whisperRangeTiles <= normalRangeTiles &&
    normalRangeTiles <= yellRangeTiles &&
    yellRangeTiles <= profile.network.aoiRadiusTiles
  )) {
    issues.push({
      fieldPath: "speech.yellRangeTiles",
      message: `Speech ranges must satisfy whisper (${String(whisperRangeTiles)}) <= normal (${String(normalRangeTiles)}) <= yell (${String(yellRangeTiles)}) <= aoiRadiusTiles (${String(profile.network.aoiRadiusTiles)})`,
    });
  }

  if (profile.pvp.shortTermMurderDecaySec > profile.pvp.longTermMurderDecaySec) {
    issues.push({
      fieldPath: "pvp.shortTermMurderDecaySec",
      message: `shortTermMurderDecaySec (${String(profile.pvp.shortTermMurderDecaySec)}) must be <= longTermMurderDecaySec (${String(profile.pvp.longTermMurderDecaySec)})`,
    });
  }

  const hasActiveFacet =
    profile.features.feluccaEnabled ||
    profile.features.trammelEnabled ||
    profile.features.ilshenarEnabled ||
    profile.features.malasEnabled ||
    profile.features.tokunoEnabled ||
    profile.features.terMurEnabled;
  if (!hasActiveFacet) {
    issues.push({
      fieldPath: "features.feluccaEnabled",
      message: "At least one gameplay facet must remain enabled",
    });
  }

  return issues;
}

export function computeRulesetDigest(profile: DeepReadonly<RulesetProfile>): string {
  return sha256Hex(canonicalJsonStringify(profile));
}

export function assertValidRulesetProfile(candidate: unknown): RulesetProfile {
  if (!RulesetProfileValidator.Check(candidate)) {
    const schemaIssues: RulesetValidationIssue[] = [];
    for (const err of RulesetProfileValidator.Errors(candidate)) {
      schemaIssues.push({
        fieldPath: err.path.replace(/^\//, "").replace(/\//g, ".") || "profile",
        message: err.message,
      });
    }
    throw new DomainError(
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
      `Resolved ruleset failed schema validation (${String(schemaIssues.length)} error(s))`,
      {
        ...(schemaIssues[0] !== undefined ? { fieldPath: schemaIssues[0].fieldPath } : {}),
        details: { issues: schemaIssues },
      },
    );
  }
  return candidate;
}

export function resolveRulesetProfile(
  options: ResolveRulesetOptions = {},
): DeepReadonly<ResolvedRulesetProfile> {
  const presetId = options.preset ?? "uor";
  const env = options.environment ?? "development";
  const basePreset = getRulesetPreset(presetId);

  if (basePreset.meta.nonProductionOnly && env === "production") {
    throw new DomainError(
      DomainErrorCode.ERR_NON_PROD_PRESET_FORBIDDEN,
      `Preset "${presetId}" is marked nonProductionOnly and cannot be used in production`,
      { fieldPath: "preset", details: { presetId, environment: env } },
    );
  }

  const validatedOverrides = assertNoUnknownKeys(options.overrides);
  const merged = assertValidRulesetProfile(mergeProfile(basePreset, validatedOverrides));

  const issues = validateRulesetInvariants(merged);
  if (issues.length > 0) {
    throw new DomainError(
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
      `Ruleset invariant violation (${String(issues.length)}): ${issues.map((i) => `${i.fieldPath}: ${i.message}`).join("; ")}`,
      { fieldPath: issues[0]!.fieldPath, details: { issues } },
    );
  }

  const profileDigest = computeRulesetDigest(merged);
  return deepFreeze<ResolvedRulesetProfile>({
    ...merged,
    profileDigest,
  });
}

export function resolveRulesetFromConfig(
  presetFromEnv: string | undefined,
  rawFileData: unknown,
  environment: RulesetEnvironment = "development",
): DeepReadonly<ResolvedRulesetProfile> {
  if (rawFileData === undefined || rawFileData === null) {
    return resolveRulesetProfile({
      preset: presetFromEnv ?? "uor",
      environment,
    });
  }

  if (typeof rawFileData !== "object" || Array.isArray(rawFileData)) {
    throw new DomainError(
      DomainErrorCode.ERR_RULESET_INVARIANT_VIOLATION,
      "shard-ruleset.yaml root must be a YAML mapping object",
      { fieldPath: "root" },
    );
  }

  const fileObj = rawFileData as Record<string, unknown>;
  const allowedTopKeys = new Set(["preset", "environment", "overrides"]);
  for (const key of Object.keys(fileObj)) {
    if (!allowedTopKeys.has(key)) {
      throw new DomainError(
        DomainErrorCode.ERR_RULESET_UNKNOWN_KEY,
        `Unknown top-level key in shard-ruleset.yaml: "${key}"`,
        { fieldPath: key, details: { key } },
      );
    }
  }

  const filePreset = typeof fileObj["preset"] === "string" ? fileObj["preset"] : undefined;
  const effectivePreset = presetFromEnv ?? filePreset ?? "uor";
  const effectiveEnv =
    typeof fileObj["environment"] === "string" &&
    (fileObj["environment"] === "production" ||
      fileObj["environment"] === "staging" ||
      fileObj["environment"] === "development" ||
      fileObj["environment"] === "test")
      ? fileObj["environment"]
      : environment;

  return resolveRulesetProfile({
    preset: effectivePreset,
    overrides: fileObj["overrides"],
    environment: effectiveEnv,
  });
}
