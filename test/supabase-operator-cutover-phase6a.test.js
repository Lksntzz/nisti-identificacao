import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reserveGeminiBudget } from '../src/gemini-budget.js';

const configuredEnv = {
  SUPABASE_READS_ENABLED: '1',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
  SUPABASE_READ_TIMEOUT_MS: '1000'
};

function d1BudgetEnv(changes = 1) {
  let calls = 0;
  return {
    get calls() { return calls; },
    DB: {
      prepare(sql) {
        calls += 1;
        return {
          bind() { return this; },
          async run() {
            return /INSERT INTO gemini_call_budget/i.test(sql)
              ? { meta: { changes } }
              : { meta: { changes: 0 } };
          }
        };
      }
    }
  };
}

function response(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('Gemini budget stays on D1 while Supabase cutover switch is off', async () => {
  const d1 = d1BudgetEnv();
  const allowed = await reserveGeminiBudget({ ...d1, SUPABASE_READS_ENABLED: '0' }, 'verifier', 60);
  assert.equal(allowed, true);
  assert.ok(d1.calls >= 2);
});

test('Gemini budget uses atomic Supabase RPC without touching D1 when enabled', async () => {
  const originalFetch = globalThis.fetch;
  const d1 = d1BudgetEnv();
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), init };
    return response('true');
  };
  try {
    const allowed = await reserveGeminiBudget({ ...configuredEnv, DB: d1.DB }, 'catalog-verifier-total-v8', 60);
    assert.equal(allowed, true);
    assert.equal(d1.calls, 0);
    assert.match(seen.url, /\/rpc\/nisti_reserve_gemini_budget$/);
    const body = JSON.parse(seen.init.body);
    assert.equal(body.p_lane, 'catalog-verifier-total-v8');
    assert.equal(body.p_limit, 60);
    assert.ok(Number.isInteger(body.p_window_minute));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('temporary Supabase budget outage may use transitional D1 fallback', async () => {
  const originalFetch = globalThis.fetch;
  const d1 = d1BudgetEnv();
  globalThis.fetch = async () => response('{"message":"temporary"}', 503);
  try {
    assert.equal(await reserveGeminiBudget({ ...configuredEnv, DB: d1.DB }, 'verifier', 60), true);
    assert.ok(d1.calls >= 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Supabase auth/config budget errors fail closed instead of hiding behind D1', async () => {
  const originalFetch = globalThis.fetch;
  const d1 = d1BudgetEnv();
  globalThis.fetch = async () => response('{"message":"unauthorized"}', 401);
  try {
    await assert.rejects(
      () => reserveGeminiBudget({ ...configuredEnv, DB: d1.DB }, 'verifier', 60),
      /Supabase RPC nisti_reserve_gemini_budget falhou \(401\)/
    );
    assert.equal(d1.calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Gemini budget migration is server-only, atomic, and SECURITY INVOKER', () => {
  const source = fs.readFileSync('supabase/migrations/202609050230_nisti_gemini_budget_rpc_v1.sql', 'utf8');
  assert.match(source, /PRIMARY KEY \(lane, window_minute\)/);
  assert.match(source, /ON CONFLICT \(lane, window_minute\) DO UPDATE/);
  assert.match(source, /WHERE public\.gemini_call_budget\.used < p_limit/);
  assert.match(source, /SECURITY INVOKER/);
  assert.doesNotMatch(source, /SECURITY DEFINER/i);
  assert.match(source, /REVOKE ALL ON FUNCTION public\.nisti_reserve_gemini_budget\(TEXT, BIGINT, INTEGER\)/);
  assert.match(source, /GRANT EXECUTE ON FUNCTION public\.nisti_reserve_gemini_budget\(TEXT, BIGINT, INTEGER\)[\s\S]*TO service_role/);
});

test('structural fallback reads use preferred Supabase store and legacy self-training is removed', () => {
  const source = fs.readFileSync('src/structural-final-v8.js', 'utf8');
  assert.match(source, /preferSupabaseRead/);
  assert.match(source, /supabaseProductsForCover/);
  assert.match(source, /supabaseReferenceById/);
  assert.match(source, /supabaseReferenceByCover/);
  assert.doesNotMatch(source, /autoLearnVisualSample/);
  assert.doesNotMatch(source, /reference_kind='auto_learned'/);
  assert.doesNotMatch(source, /references\/learned\//);

  const metadataSection = source.slice(
    source.indexOf('async function candidateCatalogMetadata'),
    source.indexOf('async function d1ReferenceById')
  );
  assert.doesNotMatch(metadataSection, /env\.DB\.prepare/);
  assert.match(metadataSection, /productsForCover/);

  const resolveSection = source.slice(
    source.indexOf('async function resolveCandidate'),
    source.indexOf('function parseStructuredJson')
  );
  assert.match(resolveSection, /preferSupabaseRead/);
  assert.doesNotMatch(resolveSection, /env\.DB\.prepare/);
});

test('production cutover switches remain off by default', () => {
  const wrangler = fs.readFileSync('wrangler.toml', 'utf8');
  assert.match(wrangler, /SUPABASE_READS_ENABLED\s*=\s*"0"/);
});
