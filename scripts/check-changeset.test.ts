import { describe, expect, it } from "vitest";
import { evaluateChangesetRequirement } from "./check-changeset.js";

describe("Changesets PR policy (scripts/check-changeset.ts)", () => {
  it("passes when production src changes include a .changeset/*.md file", () => {
    const res = evaluateChangesetRequirement({
      changedFiles: ["packages/config/src/env/server/loader.ts", ".changeset/tidy-lions-jump.md"],
    });
    expect(res.ok).toBe(true);
    expect(res.requiresChangeset).toBe(true);
    expect(res.hasChangesetFile).toBe(true);
  });

  it("fails when production src changes lack both changeset file and exemption label", () => {
    const res = evaluateChangesetRequirement({
      changedFiles: ["packages/db/src/client.ts"],
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("pnpm exec changeset");
  });

  it("passes when PR has no-changeset-needed label", () => {
    const res = evaluateChangesetRequirement({
      changedFiles: ["apps/api/src/health.controller.ts"],
      prLabels: ["no-changeset-needed"],
    });
    expect(res.ok).toBe(true);
    expect(res.exemptedByLabel).toBe(true);
  });

  it("passes without changeset when PR modifies only docs, openspec, tests, or CI", () => {
    const res = evaluateChangesetRequirement({
      changedFiles: [
        "docs/ARCHITECTURE.md",
        "openspec/changes/p00-monorepo-foundation/tasks.md",
        "packages/config/src/env/server/loader.test.ts",
        ".github/workflows/ci.yml",
      ],
    });
    expect(res.ok).toBe(true);
    expect(res.requiresChangeset).toBe(false);
  });
});
