import test from 'node:test';
import assert from 'node:assert/strict';

import {
  explicitUtcTimestamp,
  parseNistiTimestamp,
  formatSaoPauloDateTime
} from '../src/date-time.js';

test('D1 CURRENT_TIMESTAMP is treated as UTC before formatting', () => {
  assert.equal(
    explicitUtcTimestamp('2026-09-29 18:00:00'),
    '2026-09-29T18:00:00Z'
  );

  const parsed = parseNistiTimestamp('2026-09-29 18:00:00');
  assert.equal(parsed?.toISOString(), '2026-09-29T18:00:00.000Z');

  const formatted = formatSaoPauloDateTime('2026-09-29 18:00:00');
  assert.equal(formatted.date, '29/09/2026');
  assert.equal(formatted.time, '15:00');
});

test('timestamps that already contain timezone are not modified', () => {
  assert.equal(
    explicitUtcTimestamp('2026-09-29T18:00:00+00:00'),
    '2026-09-29T18:00:00+00:00'
  );
});
