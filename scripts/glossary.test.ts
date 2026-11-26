import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// Понятия и названия чужой игры, которые не должны вернуться в словарь проекта.
const FORBIDDEN = [
  /\bUO\b/,
  /ultima/i,
  /felucca/i,
  /trammel/i,
  /ilshenar/i,
  /\bgump/i,
  /cliloc/i,
  /\bMUL\b/,
  /\bUOP\b/,
  /notoriety/i,
  /paperdoll/i,
  /\bmobile\b/i,
  /мобайл/i,
  /фасет/i,
  /\bhue\b/i,
  /хью/i,
  /recall/i,
  /\bIDOC\b/,
  /tiledata/i,
];

it('глоссарий не содержит понятий чужой игры', () => {
  const text = readFileSync('docs/GLOSSARY.md', 'utf8');
  expect(FORBIDDEN.filter((pattern) => pattern.test(text)).map(String)).toEqual([]);
});
