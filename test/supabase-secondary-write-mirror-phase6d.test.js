import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mirrorVisualReferencesBatchFromD1 } from '../src/supabase-secondary-write-store.js';

const configuredEnv = {
  SUPABASE_WRITE_MODE: 'mirror',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-secret',
  SUPABASE_READ_TIMEOUT_MS: '1000'
};

function response(body = 'null', status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('Phase 6D mirrors a reindex batch with one Supabase RPC', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const env = {
    ...configuredEnv,
    DB: {
      prepare(sql) {
        return {
          bind(...binds) {
            return {
              async all() {
                if (/FROM cover_visual_references/i.test(sql)) {
                  return {
                    results: binds.map(id => ({
                      id,
                      capa_code: `CP${id}`,
                      image_key: `references/${id}.jpg`,
                      source_product_id: null,
                      reference_kind: 'real_scan',
                      active: 1,
                      created_at: '2026-09-05T00:00:00Z',
                      updated_at: '2026-09-05T00:00:00Z'
                    }))
                  };
                }
                if (/FROM cover_reference_embeddings/i.test(sql)) {
                  return {
                    results: binds.map(id => ({
                      reference_id: id,
                      embedding_model: 'gemini-embedding-2',
                      dimensions: 768,
                      embedding_json: '[0]',
                      updated_at: '2026-09-05T00:00:00Z'
                    }))
                  };
                }
                throw new Error(`SQL inesperado: ${sql}`);
              }
            };
          }
        };
      }
    }
  };

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return response();
  };

  try {
    const result = await mirrorVisualReferencesBatchFromD1(env, [7, 8]);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/rpc\/nisti_mirror_visual_references_batch$/);
    const body = JSON.parse(calls[0].init.body);
    assert.deepEqual(body.p_references.map(row => row.id), [7, 8]);
    assert.deepEqual(body.p_embeddings.map(row => row.reference_id), [7, 8]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Phase 6D notification and push writers mirror only after committed D1 writes', () => {
  const notifications = fs.readFileSync('src/cover-notifications.js', 'utf8');
  const push = fs.readFileSync('src/web-push.js', 'utf8');

  assert.match(notifications, /INSERT INTO notifications[\s\S]*await mirrorNotificationByCapaFromD1/);
  assert.match(notifications, /UPDATE notifications[\s\S]*mirrorNotificationsForProductOrCoverFromD1/);
  assert.match(notifications, /INSERT INTO notification_reads[\s\S]*mirrorNotificationReadFromD1/);
  assert.match(notifications, /markAllNotificationsRead[\s\S]*mirrorNotificationReadsForUserFromD1/);

  assert.match(push, /INSERT INTO push_subscriptions[\s\S]*mirrorPushSubscriptionByEndpointFromD1/);
  assert.match(push, /DELETE FROM push_subscriptions[\s\S]*mirrorDeletedPushSubscriptionToSupabase/);
  assert.doesNotMatch(push, /nisti_mirror_push_log/);
});

test('Phase 6D covers finish edits, synthetic notifications, reindex maintenance, shadow confirmation and operator rename', () => {
  const mutationMirror = fs.readFileSync('src/supabase-mutation-mirror.js', 'utf8');
  const reindex = fs.readFileSync('src/reference-reindex-router.js', 'utf8');
  const shadowConfirmation = fs.readFileSync('src/geometric-shadow-confirmation-router.js', 'utf8');
  const systemMetrics = fs.readFileSync('src/system-metrics-clean-router.js', 'utf8');

  assert.ok(mutationMirror.includes('const productFinish = url.pathname.match'));
  assert.ok(mutationMirror.includes('mirrorProductCatalogFromD1(env, Number(productFinish[1]))'));
  assert.match(mutationMirror, /\/api\/admin\/notifications\/test/);
  assert.match(mutationMirror, /mirrorNotificationByCapaFromD1/);
  assert.match(reindex, /mirrorVisualReferencesBatchFromD1/);
  assert.match(reindex, /processedIds/);
  assert.match(shadowConfirmation, /supabaseWriteMode\(env\) === 'mirror'/);
  assert.match(shadowConfirmation, /nisti_mirror_confirm_geometric_shadow/);
  assert.match(systemMetrics, /supabaseWriteMode\(env\) === 'mirror'/);
  assert.match(systemMetrics, /nisti_mirror_operator_name/);
});

test('Phase 6D SQL is SECURITY INVOKER and service-role only', () => {
  const source = fs.readFileSync(
    'supabase/migrations/202609050415_nisti_secondary_write_mirror_rpc_v1.sql',
    'utf8'
  );

  const functions = [
    'nisti_mirror_visual_references_batch',
    'nisti_mirror_notifications_batch',
    'nisti_mirror_notification_reads_batch',
    'nisti_mirror_push_subscription',
    'nisti_delete_push_subscription',
    'nisti_mirror_operator_name'
  ];

  for (const fn of functions) {
    assert.match(source, new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`));
    assert.match(source, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}`));
    assert.match(source, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}`));
  }

  assert.doesNotMatch(source, /SECURITY DEFINER/i);
  assert.ok((source.match(/SECURITY INVOKER/g) || []).length >= functions.length);
  assert.match(source, /INSERT INTO public\.notifications \(\s*id,/);
  assert.match(source, /INSERT INTO public\.notification_reads \(id,notification_id,user_id,read_at\)/);
  assert.match(source, /INSERT INTO public\.push_subscriptions \(\s*id,/);
  assert.match(source, /UPDATE public\.recognition_events[\s\S]*operator_name/);
});

test('active D1 mutations remain confined to reviewed writer modules', () => {
  const allowed = new Map([
    ['products', new Set(['core-router.js', 'product-finish-router.js'])],
    ['product_platforms', new Set(['core-router.js'])],
    ['recognition_daily', new Set(['recognition-metrics.js'])],
    ['recognition_events', new Set(['recognition-metrics.js', 'system-metrics-clean-router.js'])],
    ['cover_visual_references', new Set(['core-router.js', 'occurrences-router.js'])],
    ['cover_reference_embeddings', new Set(['core-router.js', 'occurrences-router.js', 'reference-reindex-router.js'])],
    ['notifications', new Set(['core-router.js', 'cover-notifications.js'])],
    ['notification_reads', new Set(['cover-notifications.js'])],
    ['push_subscriptions', new Set(['web-push.js'])],
    ['scan_occurrences', new Set(['occurrences-router.js'])],
    ['geometric_shadow_evidence', new Set(['geometric-shadow-evidence-router.js', 'geometric-shadow-confirmation-router.js'])],
    ['gemini_call_budget', new Set(['gemini-budget.js'])],
    ['push_logs', new Set(['web-push.js'])]
  ]);

  const files = fs.readdirSync('src')
    .filter(name => name.endsWith('.js'));
  const mutation = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/gi;

  for (const file of files) {
    const source = fs.readFileSync(path.join('src', file), 'utf8');
    for (const match of source.matchAll(mutation)) {
      const table = match[1].toLowerCase();
      if (!allowed.has(table)) continue;
      assert.ok(allowed.get(table).has(file), `unexpected D1 writer: ${file} -> ${table}`);
    }
  }
});

test('Phase 6D still does not enable production cutover', () => {
  const wrangler = fs.readFileSync('wrangler.toml', 'utf8');
  assert.match(wrangler, /SUPABASE_WRITE_MODE\s*=\s*"off"/);
  assert.match(wrangler, /SUPABASE_READS_ENABLED\s*=\s*"0"/);
});
