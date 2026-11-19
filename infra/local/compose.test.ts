import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const ROOT_DIR = resolve(import.meta.dirname, "../..");

interface ComposeService {
  readonly image?: string;
  readonly profiles?: readonly string[];
  readonly ports?: readonly string[];
  readonly healthcheck?: {
    readonly test?: unknown;
    readonly interval?: string;
  };
}

interface ComposeFile {
  readonly services: Record<string, ComposeService>;
  readonly volumes?: Record<string, unknown>;
}

function parseIntervalSeconds(interval: string): number {
  const match = /^(\d+)s$/.exec(interval.trim());
  if (!match?.[1]) {
    throw new Error(`Unsupported healthcheck interval format: ${interval}`);
  }
  return Number.parseInt(match[1], 10);
}

describe("Local Docker Compose specification validation", () => {
  const rawCompose = readFileSync(join(ROOT_DIR, "docker-compose.yml"), "utf8");
  const compose = parseYaml(rawCompose) as ComposeFile;

  it("separates core (3 services) and observability (5 services) profiles cleanly", () => {
    const core = Object.entries(compose.services)
      .filter(([, svc]) => svc.profiles?.includes("core"))
      .map(([name]) => name)
      .sort();
    const obs = Object.entries(compose.services)
      .filter(([, svc]) => svc.profiles?.includes("observability"))
      .map(([name]) => name)
      .sort();

    expect(core).toEqual(["nats", "postgres", "valkey"]);
    expect(obs).toEqual(["grafana", "loki", "otel-collector", "prometheus", "tempo"]);
  });

  it("forbids :latest or floating major-only image tags across all services", () => {
    for (const [name, svc] of Object.entries(compose.services)) {
      const image = svc.image ?? "";
      expect(image, `service ${name}`).not.toContain(":latest");
      expect(image, `service ${name} must pin concrete version tag`).toMatch(
        /:v?\d+\.\d+(\.\d+)?(-[a-z0-9.-]+)?$/i,
      );
    }
  });

  it("defines healthcheck with interval <= 10s and parameterized host ports on every service", () => {
    for (const [name, svc] of Object.entries(compose.services)) {
      expect(svc.healthcheck, `service ${name} missing healthcheck`).toBeDefined();
      const interval = svc.healthcheck?.interval ?? "";
      expect(parseIntervalSeconds(interval), `service ${name} interval`).toBeLessThanOrEqual(10);

      for (const portSpec of svc.ports ?? []) {
        expect(portSpec, `service ${name} port ${portSpec} must be parameterized`).toMatch(
          /^\$\{[A-Z0-9_]+:-\d+\}:\d+$/,
        );
      }
    }
  });

  it("validates YAML/JSON syntax of all local telemetry and Grafana provisioning configs", () => {
    const yamlFiles = [
      "infra/local/otel/otel-collector-config.yaml",
      "infra/local/prometheus/prometheus.yml",
      "infra/local/loki/loki-config.yaml",
      "infra/local/tempo/tempo-config.yaml",
      "infra/local/grafana/provisioning/datasources/datasources.yaml",
      "infra/local/grafana/provisioning/dashboards/provider.yaml",
    ];
    for (const rel of yamlFiles) {
      const parsed = parseYaml(readFileSync(join(ROOT_DIR, rel), "utf8"));
      expect(parsed, rel).toBeTruthy();
    }

    const datasources = parseYaml(
      readFileSync(
        join(ROOT_DIR, "infra/local/grafana/provisioning/datasources/datasources.yaml"),
        "utf8",
      ),
    ) as { datasources: Array<{ name: string }> };
    expect(datasources.datasources.map((d) => d.name).sort()).toEqual([
      "Loki",
      "Prometheus",
      "Tempo",
    ]);

    const dashboard = JSON.parse(
      readFileSync(
        join(ROOT_DIR, "infra/local/grafana/provisioning/dashboards/uo3-local-health.json"),
        "utf8",
      ),
    ) as { uid: string };
    expect(dashboard.uid).toBe("uo3-local-health");
  });
});
