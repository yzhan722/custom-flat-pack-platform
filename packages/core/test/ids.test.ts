import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newId, sha256Hex } from "../src";

describe("sha256 (pure implementation)", () => {
  const cases = ["", "abc", "The quick brown fox jumps over the lazy dog", "a".repeat(55), "a".repeat(56), "a".repeat(64), "a".repeat(1000), "µm × 板件 — unicode"];
  for (const c of cases) {
    it(`matches node:crypto for ${JSON.stringify(c.length > 20 ? `${c.slice(0, 12)}…(${c.length})` : c)}`, () => {
      expect(sha256Hex(c)).toBe(createHash("sha256").update(c, "utf8").digest("hex"));
    });
  }
  it("known vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("newId is prefixed and unique", () => {
    const a = newId("ord");
    const b = newId("ord");
    expect(a).toMatch(/^ord_[0-9a-f]{20}$/);
    expect(a).not.toBe(b);
  });
});
