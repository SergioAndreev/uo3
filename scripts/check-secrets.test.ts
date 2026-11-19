import { describe, expect, it } from "vitest";
import { formatSecretFindingsReport, scanContentForSecrets } from "./check-secrets.js";

describe("check-secrets scanner", () => {
  it("detects PEM private keys and AWS keys without leaking the raw secret value in the report", () => {
    const fakeAwsKey = `AKIA${"1234567890ABCDEF"}`;
    const fakePem = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    const content = `const key = "${fakeAwsKey}";\nconst pem = "${fakePem}";\n`;

    const findings = scanContentForSecrets("apps/api/src/leaked.ts", content);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.ruleId)).toEqual(
      expect.arrayContaining(["uo3-aws-access-key", "uo3-pem-private-key"]),
    );

    const report = formatSecretFindingsReport(findings);
    expect(report).toContain("[REDACTED]");
    expect(report).not.toContain(fakeAwsKey);
  });

  it("allows documented CHANGE_ME_LOCAL_DEV_ONLY placeholders in .env.example files", () => {
    const exampleContent = [
      "DATABASE_URL=postgresql://uo3:CHANGE_ME_LOCAL_DEV_ONLY@localhost:5432/uo3_dev",
      "IDENTITY_JWT_SIGNING_KEYS_JSON=CHANGE_ME_LOCAL_DEV_ONLY",
    ].join("\n");

    expect(scanContentForSecrets("apps/api/.env.example", exampleContent)).toEqual([]);
    expect(scanContentForSecrets(".env.example", exampleContent)).toEqual([]);
  });
});
