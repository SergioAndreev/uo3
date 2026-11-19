import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateAuditReport, loadAuditWaivers } from "./check-audit.js";

const ROOT_DIR = resolve(import.meta.dirname, "..");

describe("check-audit vulnerability and waiver policy", () => {
  const now = new Date("2026-11-19T12:00:00.000Z");

  it("loads valid empty waivers file and passes when there are no critical/high advisories", () => {
    const { waivers } = loadAuditWaivers(ROOT_DIR);
    expect(Array.isArray(waivers)).toBe(true);

    const report = evaluateAuditReport(
      {
        advisories: {
          "1001": {
            id: 1001,
            module_name: "minor-lib",
            severity: "moderate",
            title: "Moderate issue",
          },
        },
      },
      waivers,
      now,
    );
    expect(report.ok).toBe(true);
  });

  it("blocks unwaived critical/high advisories and allows active waiver <= 30 days", () => {
    const audit = {
      advisories: {
        "9001": {
          id: 9001,
          github_advisory_id: "GHSA-test-0001",
          module_name: "vuln-lib",
          severity: "high",
          title: "High severity issue",
        },
      },
    };

    const blocked = evaluateAuditReport(audit, [], now);
    expect(blocked.ok).toBe(false);
    expect(blocked.blockedAdvisories[0]).toContain("vuln-lib");

    const waived = evaluateAuditReport(
      audit,
      [
        {
          advisoryId: "GHSA-test-0001",
          package: "vuln-lib",
          reason: "Waiting for upstream patch",
          owner: "platform-team",
          createdAt: "2026-11-10T00:00:00.000Z",
          expiresAt: "2026-12-01T00:00:00.000Z",
        },
      ],
      now,
    );
    expect(waived.ok).toBe(true);
  });

  it("rejects expired waivers and waivers exceeding 30 days duration", () => {
    const expired = evaluateAuditReport(
      { advisories: {} },
      [
        {
          advisoryId: "GHSA-old-0001",
          package: "old-lib",
          reason: "Stale waiver",
          owner: "platform-team",
          createdAt: "2026-10-01T00:00:00.000Z",
          expiresAt: "2026-10-20T00:00:00.000Z",
        },
      ],
      now,
    );
    expect(expired.ok).toBe(false);
    expect(expired.waiverErrors[0]).toContain("истёк");

    const tooLong = evaluateAuditReport(
      { advisories: {} },
      [
        {
          advisoryId: "GHSA-long-0001",
          package: "long-lib",
          reason: "Too long waiver",
          owner: "platform-team",
          createdAt: "2026-11-01T00:00:00.000Z",
          expiresAt: "2027-01-15T00:00:00.000Z",
        },
      ],
      now,
    );
    expect(tooLong.ok).toBe(false);
    expect(tooLong.waiverErrors[0]).toContain("30");
  });
});
