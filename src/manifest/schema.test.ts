import { describe, expect, it } from "vitest";
import { decodeManifestSync, MANIFEST_VERSION } from "./schema.js";

describe("manifest schema", () => {
  it("decodes a minimal valid manifest", () => {
    const decoded = decodeManifestSync({
      version: 1,
      modes: { default: { skills: ["a", "b"] } },
    });
    expect(decoded.version).toBe(MANIFEST_VERSION);
    expect(decoded.modes["default"]?.skills).toEqual(["a", "b"]);
  });

  it("rejects unknown version", () => {
    expect(() =>
      decodeManifestSync({ version: 2, modes: {} }),
    ).toThrow();
  });

  it("rejects a mode without a skills array", () => {
    expect(() =>
      decodeManifestSync({ version: 1, modes: { default: {} } }),
    ).toThrow();
  });
});
