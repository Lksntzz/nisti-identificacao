import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router=fs.readFileSync('src/operator-audit-router.js','utf8');
const reindex=fs.readFileSync('src/reference-reindex-router.js','utf8');
const backfill=fs.readFileSync('src/supabase-reserve-backfill.js','utf8');

test('scheduled maintenance repairs pending visual references after Supabase promotion',()=>{
  assert.match(router,/supabasePrimaryWritesRequested\(env\)/);
  assert.match(router,/runReferenceReindex\(env,\{limit:4\}\)/);
  assert.match(reindex,/export async function runReferenceReindex/);
  assert.match(reindex,/nisti_pending_visual_references_v1/);
  assert.match(reindex,/nisti_upsert_reference_embedding_v1/);
  assert.match(reindex,/COVER_VECTORS\.upsert/);
});

test('scheduled maintenance does not backfill stale D1 rows into Supabase primary',()=>{
  const scheduledStart=router.indexOf('async scheduled(_controller, env, ctx)');
  const scheduled=router.slice(scheduledStart);
  const primaryBranch=scheduled.indexOf('if (supabasePrimaryWritesRequested(env))');
  const repairCall=scheduled.indexOf('runReferenceReindex(env,{limit:4})');
  const legacyBackfill=scheduled.indexOf('runReserveBackfill(env)');
  assert.ok(primaryBranch>=0 && repairCall>primaryBranch && legacyBackfill>repairCall);
  assert.match(backfill,/if \(supabasePrimaryWritesRequested\(env\)\)/);
  assert.match(backfill,/skipped:true/);
  assert.match(backfill,/reason:'supabase_primary_authority'/);
});

test('HTTP reindex endpoint and scheduled repair share one implementation',()=>{
  assert.match(reindex,/const result = await runReferenceReindex\(env,\{ limit:body\.limit \}\)/);
  assert.match(reindex,/return json\(result, result\.ok \? 200 : 207\)/);
});
