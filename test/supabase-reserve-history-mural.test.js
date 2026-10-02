import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('legacy reserve backfill stays available for rollback but is disabled under Supabase primary authority', () => {
  const backfill = fs.readFileSync('src/supabase-reserve-backfill.js','utf8');
  const router = fs.readFileSync('src/operator-audit-router.js','utf8');
  const wrangler = fs.readFileSync('wrangler.toml','utf8');

  assert.match(backfill,/WHERE id>\?/);
  assert.match(backfill,/BATCH_SIZE = 100/);
  assert.match(backfill,/mural_collection_products/);
  assert.match(backfill,/mural_post_reads/);
  assert.match(backfill,/supabasePrimaryWritesRequested\(env\)/);
  assert.match(backfill,/reason:'supabase_primary_authority'/);
  assert.match(router,/async scheduled\(_controller, env, ctx\)/);
  assert.match(router,/runReferenceReindex\(env,\{limit:4\}\)/);
  assert.match(router,/runReserveBackfill\(env\)/);
  assert.doesNotMatch(router,/\/api\/admin\/reserve-sync\/run/);
  assert.match(wrangler,/crons = \["\*\/30 \* \* \* \*"\]/);
});


test('GTIN history mirrors new events directly and reads reserve only after backfill readiness', () => {
  const gtin = fs.readFileSync('src/gtin-router.js','utf8');
  const migration = fs.readFileSync(
    'supabase/migrations/20261001173500_reserve_history_mural_backfill_v1.sql',
    'utf8'
  );

  assert.match(gtin,/nisti_mirror_gtin_scan_events_batch_v1/);
  assert.match(gtin,/supabaseReserveGtinEvents/);
  assert.match(gtin,/preferSupabaseRead/);
  assert.match(migration,/nisti_reserve_stream_ready_v1\('gtin_scan_events'\)/);
  assert.match(migration,/reserve_stream_not_ready:gtin_scan_events/);
  assert.match(migration,/REVOKE ALL ON FUNCTION public\.nisti_reserve_gtin_events_v1/);
  assert.doesNotMatch(migration,/SECURITY DEFINER/i);
});

test('Mural reserve feed stays gated until all Mural streams finish backfill', () => {
  const mural = fs.readFileSync('src/mural-router.js','utf8');
  const readStore = fs.readFileSync('src/supabase-read-store.js','utf8');
  const migration = fs.readFileSync(
    'supabase/migrations/20261001173500_reserve_history_mural_backfill_v1.sql',
    'utf8'
  );
  const ops = fs.readFileSync(
    'supabase/migrations/20261001174500_reserve_mural_operational_rpc_v1.sql',
    'utf8'
  );

  assert.match(mural,/supabaseReserveMuralFeed/);
  assert.match(mural,/supabaseReserveMuralCollection/);
  assert.match(mural,/supabaseReserveMuralPostImage/);
  assert.match(mural,/supabaseReserveMuralCollectionImage/);
  assert.match(readStore,/nisti_reserve_mural_feed_v1/);
  assert.match(migration,/nisti_reserve_mural_ready_v1/);
  assert.match(migration,/reserve_stream_not_ready:mural/);
  assert.match(ops,/nisti_reserve_mural_post_image_v1/);
  assert.match(ops,/nisti_reserve_mural_collection_image_v1/);
  assert.doesNotMatch(ops,/SECURITY DEFINER/i);
});

test('Mural mutations keep the reserve copy current after initial backfill', () => {
  const mirror = fs.readFileSync('src/supabase-mutation-mirror.js','utf8');
  const secondary = fs.readFileSync('src/supabase-secondary-write-store.js','utf8');

  assert.match(secondary,/mirrorMuralPostFromD1/);
  assert.match(secondary,/mirrorMuralCollectionFromD1/);
  assert.match(secondary,/mirrorMuralPostReadFromD1/);
  assert.match(mirror,/admin\\\/mural\\\/posts/);
  assert.match(mirror,/admin\\\/mural\\\/collections/);
  assert.ok(mirror.includes("const muralRead=url.pathname.match(/^\\/api\\/mural\\/(\\d+)\\/read$/)"));
});
