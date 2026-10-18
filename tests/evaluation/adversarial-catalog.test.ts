import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = JSON.parse(readFileSync(new URL('./adversarial-cases.json', import.meta.url), 'utf8')) as {
  id: string;
  denominator: number;
  cases: Array<{ id: string; scenario: string; expected: string; evidence: string }>;
};

test('T08 adversarial catalog freezes complete E01-E26 denominator: 26/26', () => {
  const expectedIds = Array.from({ length: 26 }, (_, index) => `E${String(index + 1).padStart(2, '0')}`);
  const ids = catalog.cases.map((item) => item.id);
  assert.equal(catalog.id, 't08-adversarial-cases-v1');
  assert.equal(catalog.denominator, 26);
  assert.deepEqual(ids, expectedIds);
  assert.equal(new Set(ids).size, 26);
  assert.ok(catalog.cases.every((item) => item.scenario.trim() && item.expected.trim() && item.evidence.trim()));
});
