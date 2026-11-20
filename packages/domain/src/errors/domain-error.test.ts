import { describe, expect, it } from "vitest";
import { deepFreeze, DomainError, DomainErrorCode, isDomainError } from "./index.js";

describe("DomainError & DomainErrorCode", () => {
  it("defines unique, non-empty string codes matching their keys across all 5 capabilities", () => {
    const entries = Object.entries(DomainErrorCode);
    expect(entries.length).toBeGreaterThanOrEqual(42);

    const seen = new Set<string>();
    for (const [key, value] of entries) {
      expect(value).toBe(key);
      expect(value.startsWith("ERR_")).toBe(true);
      expect(seen.has(value)).toBe(false);
      seen.add(value);
    }
  });

  it("constructs DomainError with optional fieldPath, details, cause, and serializes via toJSON()", () => {
    const rootCause = new Error("root");
    const err = new DomainError(DomainErrorCode.ERR_INVALID_SERIAL, "Invalid serial value", {
      fieldPath: "entity.serial",
      details: { received: -1 },
      cause: rootCause,
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DomainError);
    expect(err.name).toBe("DomainError");
    expect(err.code).toBe("ERR_INVALID_SERIAL");
    expect(err.fieldPath).toBe("entity.serial");
    expect(err.details).toEqual({ received: -1 });
    expect(err.cause).toBe(rootCause);
    expect(err.toJSON()).toEqual({
      name: "DomainError",
      code: "ERR_INVALID_SERIAL",
      message: "Invalid serial value",
      fieldPath: "entity.serial",
      details: { received: -1 },
    });

    const minimal = new DomainError(DomainErrorCode.ERR_EMPTY_COLLECTION, "Collection is empty");
    expect(minimal.toJSON()).toEqual({
      name: "DomainError",
      code: "ERR_EMPTY_COLLECTION",
      message: "Collection is empty",
    });
    expect(minimal.cause).toBeUndefined();
  });

  it("supports isDomainError type guard with and without expectedCode", () => {
    const err = new DomainError(DomainErrorCode.ERR_UNKNOWN_FACET, "Unknown facet 99");
    expect(isDomainError(err)).toBe(true);
    expect(isDomainError(err, DomainErrorCode.ERR_UNKNOWN_FACET)).toBe(true);
    expect(isDomainError(err, DomainErrorCode.ERR_INVALID_SERIAL)).toBe(false);
    expect(isDomainError(new Error("plain"))).toBe(false);
    expect(isDomainError("ERR_UNKNOWN_FACET")).toBe(false);
  });
});

describe("deepFreeze", () => {
  it("recursively freezes nested objects and arrays and throws TypeError on mutation", () => {
    const obj = deepFreeze({
      meta: { id: "uor", tags: ["renaissance", "canonical"] },
      nested: { count: 42 },
    });

    expect(Object.isFrozen(obj)).toBe(true);
    expect(Object.isFrozen(obj.meta)).toBe(true);
    expect(Object.isFrozen(obj.meta.tags)).toBe(true);
    expect(Object.isFrozen(obj.nested)).toBe(true);

    expect(() => {
      (obj.nested as { count: number }).count = 99;
    }).toThrow(TypeError);

    expect(() => {
      (obj.meta.tags as string[]).push("aos");
    }).toThrow(TypeError);
  });

  it("handles primitives, null, cyclic references, and accessor properties safely", () => {
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze(42)).toBe(42);
    expect(deepFreeze("hello")).toBe("hello");

    interface Cyclic {
      name: string;
      self?: Cyclic;
      readonly computed: number;
    }
    const cyclic: Cyclic = {
      name: "loop",
      get computed() {
        return 1;
      },
    };
    cyclic.self = cyclic;

    const frozen = deepFreeze(cyclic);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(frozen.self).toBe(frozen);
    expect(frozen.computed).toBe(1);

    // Calling deepFreeze again on already-frozen object is a safe no-op
    expect(deepFreeze(frozen)).toBe(frozen);
  });
});
