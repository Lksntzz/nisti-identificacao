import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync('supabase/migrations/20261023144000_repair_commerce_products_identity_sequence.sql','utf8');

test('repair Commerce master product identity only, with a short write lock',()=>{
  assert.match(sql,/lock table public\.commerce_products in share row exclusive mode/i);
  assert.match(sql,/pg_get_serial_sequence\('public\.commerce_products','id'\)/);
  assert.match(sql,/select max\(id\) from public\.commerce_products/);
  assert.match(sql,/select last_value from public\.commerce_products_id_seq/);
  assert.match(sql,/greatest\(/);
  assert.match(sql,/\btrue\s*\)/i);
});

test('sequence repair never mutates product catalog or EAN data',()=>{
  assert.doesNotMatch(sql,/\bdelete\s+from\s+public\./i);
  assert.doesNotMatch(sql,/\btruncate\s+public\./i);
  assert.doesNotMatch(sql,/\bupdate\s+public\./i);
  assert.doesNotMatch(sql,/\binsert\s+into\s+public\./i);
  assert.doesNotMatch(sql,/\bdrop\s+(?:table|sequence)\b/i);
  assert.match(sql,/^begin;/m);
  assert.match(sql,/^commit;/m);
});
