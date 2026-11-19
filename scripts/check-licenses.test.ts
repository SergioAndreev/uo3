import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateLicenses, loadLicensePolicy, type LicensePolicy } from "./check-licenses.js";

const ROOT_DIR = resolve(import.meta.dirname, "..");

describe("check-licenses SPDX whitelist validator", () => {
  const policy: LicensePolicy = loadLicensePolicy(ROOT_DIR);

  it("passes cleanly for whitelisted SPDX licenses and compound OR/AND expressions", () => {
    const violations = evaluateLicenses(
      {
        MIT: [{ name: "pkg-a", versions: ["1.0.0"], paths: ["/a"] }],
        "(MIT OR Apache-2.0)": [{ name: "pkg-b", versions: ["2.0.0"], paths: ["/b"] }],
        "(MIT AND BSD-3-Clause)": [{ name: "pkg-c", versions: ["3.0.0"], paths: ["/c"] }],
      },
      policy,
    );
    expect(violations).toEqual([]);
  });

  it("blocks AGPL-3.0-only and UNKNOWN licenses with package details", () => {
    const violations = evaluateLicenses(
      {
        "AGPL-3.0-only": [{ name: "copyleft-pkg", versions: ["1.2.3"], paths: ["apps/api"] }],
        UNKNOWN: [{ name: "mystery-pkg", versions: ["0.0.1"], paths: ["packages/db"] }],
      },
      policy,
    );
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.packageName).sort()).toEqual(["copyleft-pkg", "mystery-pkg"]);
    expect(violations[0]?.paths.length).toBeGreaterThan(0);
  });

  it("allows an audited explicit exception entry in policy", () => {
    const policyWithException: LicensePolicy = {
      ...policy,
      exceptions: [
        {
          package: "audited-pkg",
          license: "LGPL-2.1-only",
          reason: "Dynamic optional tool reviewed by legal",
          approvedBy: "security-team",
        },
      ],
    };
    const violations = evaluateLicenses(
      {
        "LGPL-2.1-only": [{ name: "audited-pkg", versions: ["1.0.0"], paths: ["/x"] }],
      },
      policyWithException,
    );
    expect(violations).toEqual([]);
  });
});
