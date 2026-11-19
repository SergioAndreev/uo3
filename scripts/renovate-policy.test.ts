import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = resolve(import.meta.dirname, "..");

interface RenovateConfig {
  readonly extends?: readonly string[];
  readonly minimumReleaseAge?: string;
  readonly prConcurrentLimit?: number;
  readonly vulnerabilityAlerts?: {
    readonly enabled?: boolean;
    readonly minimumReleaseAge?: string | null;
  };
  readonly packageRules?: ReadonlyArray<{
    readonly groupName?: string;
    readonly matchManagers?: readonly string[];
    readonly matchUpdateTypes?: readonly string[];
    readonly pinDigests?: boolean;
  }>;
}

function parseDays(age: string | undefined): number {
  const match = /^(\d+)\s*days?$/i.exec((age ?? "").trim());
  return match?.[1] ? Number.parseInt(match[1], 10) : 0;
}

describe("Renovate policy validation (renovate.json)", () => {
  const cfg = JSON.parse(readFileSync(join(ROOT_DIR, "renovate.json"), "utf8")) as RenovateConfig;

  it("enforces minimumReleaseAge >= 3 days and prConcurrentLimit <= 5", () => {
    expect(parseDays(cfg.minimumReleaseAge)).toBeGreaterThanOrEqual(3);
    expect(cfg.prConcurrentLimit).toBeDefined();
    expect(cfg.prConcurrentLimit ?? 99).toBeLessThanOrEqual(5);
  });

  it("pins GitHub Actions digests and Docker image digests", () => {
    expect(cfg.extends).toContain("helpers:pinGitHubActionDigests");
    const dockerRule = cfg.packageRules?.find((r) => r.matchManagers?.includes("docker-compose"));
    expect(dockerRule?.pinDigests).toBe(true);
  });

  it("allows immediate security vulnerability alerts without stabilization delay", () => {
    expect(cfg.vulnerabilityAlerts?.enabled).toBe(true);
    expect(cfg.vulnerabilityAlerts?.minimumReleaseAge).toBeNull();
  });

  it("separates major updates and groups ecosystem minor/patch updates", () => {
    const groupNames = (cfg.packageRules ?? []).map((r) => r.groupName).filter(Boolean);
    expect(groupNames).toEqual(
      expect.arrayContaining([
        "tooling-typescript",
        "server-stack",
        "client-stack",
        "docker-images",
        "github-actions",
      ]),
    );
    const majorRule = cfg.packageRules?.find((r) => r.matchUpdateTypes?.includes("major"));
    expect(majorRule).toBeDefined();
  });
});
