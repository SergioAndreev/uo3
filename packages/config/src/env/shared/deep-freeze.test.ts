import { describe, expect, it } from "vitest";
import { deepFreeze } from "./deep-freeze.js";

describe("deepFreeze", () => {
  it("freezes top-level, nested objects, and arrays so mutations throw TypeError", () => {
    const config = deepFreeze({
      port: 3001,
      nested: {
        host: "localhost",
        origins: ["http://localhost:5173"],
      },
    });

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.nested)).toBe(true);
    expect(Object.isFrozen(config.nested.origins)).toBe(true);

    expect(() => {
      (config as { port: number }).port = 4000;
    }).toThrow(TypeError);

    expect(() => {
      (config.nested as { host: string }).host = "evil";
    }).toThrow(TypeError);

    expect(() => {
      (config.nested.origins as string[]).push("http://evil.local");
    }).toThrow(TypeError);

    expect(config.port).toBe(3001);
    expect(config.nested.host).toBe("localhost");
    expect(config.nested.origins).toEqual(["http://localhost:5173"]);
  });

  it("handles primitives, null, and cyclic references safely", () => {
    expect(deepFreeze(42)).toBe(42);
    expect(deepFreeze(null)).toBeNull();

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const frozen = deepFreeze(cyclic);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(frozen.self).toBe(frozen);
  });
});
