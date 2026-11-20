import {
  asItemId,
  asLandId,
  asTileFlags,
  createPoint3D,
  InMemorySerialLeaseProvider,
  registerSyntheticFacet,
  SerialAllocator,
  TileFlag,
  type FacetDefinition,
  type FacetRuleType,
  type ItemTileData,
  type LandTileData,
  type Point3D,
  type SerialAllocatorOptions,
} from "@uo3/domain";
import {
  resolveRulesetProfile,
  type RulesetEnvironment,
  type RulesetPresetId,
  type ShardRulesetOverride,
} from "@uo3/rules";

export interface TestSerialAllocatorResult {
  readonly leaseProvider: InMemorySerialLeaseProvider;
  readonly allocator: SerialAllocator;
}

export function createTestSerialAllocator(
  options: Omit<SerialAllocatorOptions, "leaseProvider"> & {
    readonly leaseProvider?: InMemorySerialLeaseProvider;
  } = {},
): TestSerialAllocatorResult {
  const leaseProvider = options.leaseProvider ?? new InMemorySerialLeaseProvider();
  const allocator = new SerialAllocator({
    ...options,
    leaseProvider,
  });
  return { leaseProvider, allocator };
}

export type TestRulesetProfile = ReturnType<typeof resolveRulesetProfile>;

export function createTestRulesetProfile(
  overrides?: ShardRulesetOverride,
  preset: RulesetPresetId = "uor",
  environment: RulesetEnvironment = "test",
): TestRulesetProfile {
  return resolveRulesetProfile({
    preset,
    environment,
    ...(overrides !== undefined ? { overrides } : {}),
  });
}

export function createSyntheticFacet(
  id: number = 200,
  overrides: {
    readonly name?: string;
    readonly width?: number;
    readonly height?: number;
    readonly rules?: FacetRuleType;
  } = {},
): FacetDefinition {
  return registerSyntheticFacet({
    id,
    name: overrides.name ?? `SyntheticTest_${id}`,
    width: overrides.width ?? 256,
    height: overrides.height ?? 256,
    rules: overrides.rules ?? "FeluccaPvP",
  });
}

export function createTestPoint3D(x = 128, y = 128, z = 0): Point3D {
  return createPoint3D(x, y, z);
}

export function createTestLandTileData(overrides: Partial<LandTileData> = {}): LandTileData {
  return {
    id: overrides.id ?? asLandId(0x0003),
    name: overrides.name ?? "synthetic_grass",
    flags: overrides.flags ?? asTileFlags(0n),
    textureId: overrides.textureId ?? 0x0003,
  };
}

export function createTestItemTileData(overrides: Partial<ItemTileData> = {}): ItemTileData {
  return {
    id: overrides.id ?? asItemId(0x0e75),
    name: overrides.name ?? "synthetic_crate",
    flags: overrides.flags ?? asTileFlags(TileFlag.Surface | TileFlag.Impassable),
    weight: overrides.weight ?? 5,
    quality: overrides.quality ?? 0,
    quantity: overrides.quantity ?? 1,
    animId: overrides.animId ?? 0,
    hue: overrides.hue ?? 0,
    value: overrides.value ?? 0,
    height: overrides.height ?? 4,
  };
}
