import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router=fs.readFileSync('src/operator-audit-router.js','utf8');
const reindex=fs.readFileSync('src/reference-reindex-router.js','utf8');

test('scheduled maintenance repairs pending visual references after Supabase promotion',()=>{
  assert.match(router,/runReferenceReindex\(env,\{limit:4\}\)/);
  assert.doesNotMatch(router,/runReserveBackfill/);
  assert.doesNotMatch(router,/supabasePrimaryWritesRequested\(env\)/);
  assert.match(reindex,/export async function runReferenceReindex/);
  assert.match(reindex,/nisti_pending_visual_references_v1/);
  assert.match(reindex,/nisti_upsert_reference_embedding_v1/);
  assert.match(reindex,/COVER_VECTORS\.upsert/);
  assert.doesNotMatch(reindex,/env\.DB/);
  assert.doesNotMatch(reindex,/mirrorVisualReferencesBatchFromD1/);
});

test('scheduled runtime has no path that backfills stale D1 rows into Supabase',()=>{
  const scheduledStart=router.indexOf('async scheduled(_controller, env, ctx)');
  const scheduled=router.slice(scheduledStart);
  assert.match(scheduled,/runReferenceReindex\(env,\{limit:4\}\)/);
  assert.doesNotMatch(scheduled,/runReserveBackfill/);
  assert.doesNotMatch(scheduled,/supabase-reserve-backfill/);
});

test('HTTP reindex endpoint and scheduled repair share one implementation',()=>{
  assert.match(reindex,/const result = await runReferenceReindex\(env,\{ limit:body\.limit \}\)/);
  assert.match(reindex,/return json\(result, result\.ok \? 200 : 207\)/);
});
