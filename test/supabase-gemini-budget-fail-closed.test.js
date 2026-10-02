import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('src/gemini-budget.js','utf8');
const wrangler=fs.readFileSync('wrangler.toml','utf8');

test('Gemini budget uses Supabase without any runtime D1 emergency fallback in production',()=>{
  assert.match(source,/nisti_reserve_gemini_budget/);
  assert.doesNotMatch(source,/supabaseEmergencyFallbackRequested/);
  assert.doesNotMatch(source,/SUPABASE_EMERGENCY_/);
  assert.match(wrangler,/SUPABASE_READS_ENABLED = "1"/);
  assert.doesNotMatch(wrangler,/SUPABASE_EMERGENCY_/);
});

test('legacy D1 budget path is reachable only when Supabase reads are explicitly disabled',()=>{
  const start=source.indexOf('export async function reserveGeminiBudget');
  const block=source.slice(start);
  const legacyGate=block.indexOf("if (!supabaseReadsRequested(env))");
  const legacyCall=block.indexOf('return reserveD1Budget(env, cleanLane, limit, windowMinute)',legacyGate);
  const supabaseCall=block.indexOf("nisti_reserve_gemini_budget",legacyGate);
  assert.ok(legacyGate>=0 && legacyCall>legacyGate && supabaseCall>legacyCall);
  assert.doesNotMatch(block,/catch \(error\)/);
});
