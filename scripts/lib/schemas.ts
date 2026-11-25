import { Type } from '@sinclair/typebox';

const strict = { additionalProperties: false };

export const AssetManifestSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    schemaVersion: Type.Literal(1),
    maxBinaryBytes: Type.Literal(524_288),
    assets: Type.Array(
      Type.Object(
        {
          path: Type.String({ minLength: 1 }),
          sha256: Type.String({ pattern: '^[0-9a-f]{64}$' }),
          license: Type.Union([
            Type.Literal('CC0-1.0'),
            Type.Literal('CC-BY-4.0'),
            Type.Literal('original'),
            Type.Literal('synthetic-generated'),
          ]),
          source: Type.String({ minLength: 1 }),
          addedInPhase: Type.String({ pattern: '^P\\d{2}$' }),
        },
        strict,
      ),
    ),
  },
  strict,
);

export const AuditWaiversSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    waivers: Type.Array(
      Type.Object(
        {
          advisoryId: Type.String({ pattern: '^(GHSA|CVE)-' }),
          package: Type.String({ minLength: 1 }),
          reason: Type.String({ minLength: 10 }),
          owner: Type.String({ minLength: 1 }),
          createdAt: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
          expiresAt: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
        },
        strict,
      ),
    ),
  },
  strict,
);

export const LicensePolicySchema = Type.Object(
  {
    allowedSpdx: Type.Array(Type.String(), { minItems: 1 }),
    deniedPatterns: Type.Array(Type.String(), { minItems: 1 }),
    exceptions: Type.Array(
      Type.Object(
        {
          package: Type.String({ minLength: 1 }),
          license: Type.String({ minLength: 1 }),
          reason: Type.String({ minLength: 10 }),
        },
        strict,
      ),
    ),
  },
  strict,
);
