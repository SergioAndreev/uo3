import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

interface Service {
  image: string;
  profiles: string[];
  ports: string[];
  mem_limit: string;
  healthcheck?: { test: string[]; interval: string };
}
const text = readFileSync('docker-compose.yml', 'utf8');
const { services } = parse(text) as { services: Record<string, Service> };
const readme = readFileSync('infra/local/README.md', 'utf8').replace(/ +/g, ' ');
const example = readFileSync('.env.example', 'utf8');

it('профили разделены', () => {
  const inProfile = (profile: string) =>
    Object.keys(services).filter((name) => services[name]?.profiles.join() === profile);
  expect(inProfile('core')).toEqual(['postgres', 'valkey', 'nats']);
  expect(inProfile('observability')).toEqual([
    'otel-collector',
    'prometheus',
    'loki',
    'tempo',
    'grafana',
  ]);
  expect(Object.keys(services)).toHaveLength(8);
});

it.each(Object.entries(services))('%s: тег, healthcheck, порты, память', (_, service) => {
  expect(service.image).toMatch(/:v?\d+\.\d+/);
  expect(service.healthcheck?.test.length).toBeGreaterThan(0);
  expect(Number.parseInt(service.healthcheck?.interval ?? '99', 10)).toBeLessThanOrEqual(10);
  expect(service.mem_limit).toBeTruthy();
  for (const port of service.ports) {
    const match = /^127\.0\.0\.1:\$\{(\w+_PORT):-(\d+)\}:\d+$/.exec(port);
    expect(match, port).not.toBeNull();
    expect(example).toContain(`${match?.[1]}=${match?.[2]}`);
    expect(readme).toContain(`\`${match?.[1]}\` | ${match?.[2]}`);
  }
});
