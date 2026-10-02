import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('src/gemini-budget.js','utf8');
const wrangler=fs.readFileSync('wrangler.toml','utf8');

test('Gemini budget is Supabase-only in the runtime',()=>{
  assert.match(source,/nisti_reserve_gemini_budget/);
  assert.match(source,/supabaseRpc/);
  assert.doesNotMatch(source,/env\.DB/);
  assert.doesNotMatch(source,/reserveD1Budget/);
  assert.doesNotMatch(source,/supabaseReadsRequested/);
  assert.match(wrangler,/SUPABASE_READS_ENABLED = "1"/);
});

test('Gemini budget has no fallback branch after Supabase promotion',()=>{
  const start=source.indexOf('export async function reserveGeminiBudget');
  const block=source.slice(start);
  assert.doesNotMatch(block,/if \(!supabaseReadsRequested/);
  assert.doesNotMatch(block,/catch \(error\)/);
  assert.doesNotMatch(block,/D1/);
});
