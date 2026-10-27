import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const plain = x => JSON.parse(JSON.stringify(x));

test('cobertura conta os dias abrangidos por relatórios de período (Shopee mensal)', () => {
  const sql = fs.readFileSync('supabase/migrations/20261023230000_commerce_evolution_period_coverage_falling_v1.sql', 'utf8');
  assert.match(sql, /generate_series\(\s*greatest\(sm\.period_start,l\.end_date-179\)/);
  assert.doesNotMatch(sql, /and sm\.period_start=sm\.period_end\)::int covered_30/);
  assert.match(sql, /b\.status='COMMITTED'/);
  assert.doesNotMatch(sql, /\b(?:update|delete from|insert into|truncate)\s+public\./i);
  assert.match(sql, /to service_role/);
});
