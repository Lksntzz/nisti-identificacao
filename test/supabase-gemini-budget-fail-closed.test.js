import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('src/gemini-budget.js','utf8');
const wrangler=fs.readFileSync('wrangler.toml','utf8');

test('Gemini budget uses Supabase without automatic D1 fallback in production',()=>{
  assert.match(source,/supabaseEmergencyFallbackRequested\(env\)/);
  assert.match(source,/nisti_reserve_gemini_budget/);
  assert.match(source,/fallback D1 explicitamente habilitado/);
  assert.match(wrangler,/SUPABASE_READS_ENABLED = "1"/);
  assert.match(wrangler,/SUPABASE_EMERGENCY_FALLBACK_ENABLED = "0"/);
});

test('Gemini budget only enters D1 fallback with explicit emergency opt-in',()=>{
  const start=source.indexOf('export async function reserveGeminiBudget');
  const block=source.slice(start);
  const gate=block.indexOf('supabaseEmergencyFallbackRequested(env)');
  const fallback=block.indexOf('return reserveD1Budget(env, cleanLane, limit, windowMinute)',gate);
  assert.ok(gate>=0 && fallback>gate);
});
