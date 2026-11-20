import { describe, expect, it } from "vitest";
import { sha256Bytes, sha256Hex, utf8Encode } from "./sha256.js";

describe("domain/runtime — Pure Isomorphic SHA-256 & UTF-8 Encoder", () => {
  it("encodes 1-byte ASCII, 2-byte Cyrillic, 3-byte BMP, and 4-byte surrogate pairs accurately", () => {
    expect(Array.from(utf8Encode("A"))).toEqual([0x41]);
    // "Б" (U+0411) -> 0xD0 0x91
    expect(Array.from(utf8Encode("Б"))).toEqual([0xd0, 0x91]);
    // "€" (U+20AC) -> 0xE2 0x82 0xAC
    expect(Array.from(utf8Encode("€"))).toEqual([0xe2, 0x82, 0xac]);
    // "🐉" (U+1F409) -> 0xF0 0x9F 0x90 0x89
    expect(Array.from(utf8Encode("🐉"))).toEqual([0xf0, 0x9f, 0x90, 0x89]);
  });

  it("matches NIST FIPS 180-4 SHA-256 vectors for both strings and Uint8Array inputs", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Bytes("Б€🐉").byteLength).toBe(32);
  });
});
