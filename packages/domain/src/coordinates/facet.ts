import { DomainError, DomainErrorCode } from "../errors/domain-error.js";

export type FacetId = number & { readonly __brand: "FacetId" };
export type FacetRuleType = "FeluccaPvP" | "TrammelSafe" | "Internal";

export interface FacetDefinition {
  readonly id: FacetId;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly rules: FacetRuleType;
  readonly synthetic: boolean;
}

export const FACET_FELUCCA = 0 as FacetId;
export const FACET_TRAMMEL = 1 as FacetId;
export const FACET_ILSHENAR = 2 as FacetId;
export const FACET_MALAS = 3 as FacetId;
export const FACET_TOKUNO = 4 as FacetId;
export const FACET_TERMUR = 5 as FacetId;
export const FACET_INTERNAL = 127 as FacetId;

export const SYNTHETIC_FACET_ID_MIN = 200;
export const SYNTHETIC_FACET_ID_MAX = 254;
export const MIN_SYNTHETIC_FACET_SIZE = 64;
export const FACET_ALIGNMENT_TILES = 16;

export const BUILTIN_FACETS: Readonly<Record<number, FacetDefinition>> = Object.freeze({
  [FACET_FELUCCA]: Object.freeze({
    id: FACET_FELUCCA,
    name: "Felucca",
    width: 7168,
    height: 4096,
    rules: "FeluccaPvP",
    synthetic: false,
  }),
  [FACET_TRAMMEL]: Object.freeze({
    id: FACET_TRAMMEL,
    name: "Trammel",
    width: 7168,
    height: 4096,
    rules: "TrammelSafe",
    synthetic: false,
  }),
  [FACET_ILSHENAR]: Object.freeze({
    id: FACET_ILSHENAR,
    name: "Ilshenar",
    width: 2304,
    height: 1600,
    rules: "TrammelSafe",
    synthetic: false,
  }),
  [FACET_MALAS]: Object.freeze({
    id: FACET_MALAS,
    name: "Malas",
    width: 2560,
    height: 2048,
    rules: "TrammelSafe",
    synthetic: false,
  }),
  [FACET_TOKUNO]: Object.freeze({
    id: FACET_TOKUNO,
    name: "Tokuno",
    width: 1448,
    height: 1448,
    rules: "TrammelSafe",
    synthetic: false,
  }),
  [FACET_TERMUR]: Object.freeze({
    id: FACET_TERMUR,
    name: "TerMur",
    width: 1280,
    height: 4096,
    rules: "TrammelSafe",
    synthetic: false,
  }),
  [FACET_INTERNAL]: Object.freeze({
    id: FACET_INTERNAL,
    name: "Internal",
    width: 7168,
    height: 4096,
    rules: "Internal",
    synthetic: false,
  }),
});

const syntheticFacets = new Map<number, FacetDefinition>();

export interface RegisterSyntheticFacetInput {
  readonly id: number;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly rules?: FacetRuleType;
}

export function registerSyntheticFacet(input: RegisterSyntheticFacetInput): FacetDefinition {
  if (
    !Number.isInteger(input.id) ||
    input.id < SYNTHETIC_FACET_ID_MIN ||
    input.id > SYNTHETIC_FACET_ID_MAX
  ) {
    throw new DomainError(
      DomainErrorCode.ERR_UNKNOWN_FACET,
      `Synthetic facet ID must be an integer in [${String(SYNTHETIC_FACET_ID_MIN)}, ${String(SYNTHETIC_FACET_ID_MAX)}], received ${String(input.id)}`,
      { fieldPath: "facet.id", details: { id: input.id } },
    );
  }

  if (
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width < MIN_SYNTHETIC_FACET_SIZE ||
    input.height < MIN_SYNTHETIC_FACET_SIZE ||
    input.width > 65535 ||
    input.height > 65535 ||
    input.width % FACET_ALIGNMENT_TILES !== 0 ||
    input.height % FACET_ALIGNMENT_TILES !== 0
  ) {
    throw new DomainError(
      DomainErrorCode.ERR_INVALID_FACET_DIMENSIONS,
      `Synthetic facet dimensions must be multiples of ${String(FACET_ALIGNMENT_TILES)} and >= ${String(MIN_SYNTHETIC_FACET_SIZE)}×${String(MIN_SYNTHETIC_FACET_SIZE)} (received ${String(input.width)}×${String(input.height)})`,
      { fieldPath: "facet.dimensions", details: { width: input.width, height: input.height } },
    );
  }

  const def: FacetDefinition = Object.freeze({
    id: input.id as FacetId,
    name: input.name,
    width: input.width,
    height: input.height,
    rules: input.rules ?? "FeluccaPvP",
    synthetic: true,
  });
  syntheticFacets.set(input.id, def);
  return def;
}

export function unregisterSyntheticFacet(id: number): boolean {
  return syntheticFacets.delete(id);
}

export function isKnownFacetId(id: number): id is FacetId {
  return Number.isInteger(id) && (id in BUILTIN_FACETS || syntheticFacets.has(id));
}

export function asFacetId(id: number, fieldPath?: string): FacetId {
  if (!isKnownFacetId(id)) {
    throw new DomainError(DomainErrorCode.ERR_UNKNOWN_FACET, `Unknown facet ID: ${String(id)}`, {
      ...(fieldPath !== undefined ? { fieldPath } : {}),
      details: { facetId: id },
    });
  }
  return id;
}

export function getFacet(id: FacetId | number): FacetDefinition {
  const facetId = asFacetId(id);
  const found = BUILTIN_FACETS[facetId] ?? syntheticFacets.get(facetId);
  if (!found) {
    throw new DomainError(DomainErrorCode.ERR_UNKNOWN_FACET, `Unknown facet ID: ${String(id)}`);
  }
  return found;
}

export function listFacets(): readonly FacetDefinition[] {
  return [...Object.values(BUILTIN_FACETS), ...syntheticFacets.values()];
}

export function resolveFacetDefinition(facet: FacetId | number | FacetDefinition): FacetDefinition {
  return typeof facet === "number" ? getFacet(facet) : facet;
}
