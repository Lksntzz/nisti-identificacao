import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dispatchScheduledMuralNotifications } from '../src/mural-router.js';

const read = path => fs.readFileSync(new URL('../' + path,import.meta.url),'utf8');

test('scheduled Mural push is enabled only for operator-visible content', () => {
  const router=read('src/mural-router.js');
  assert.match(router,/const MURAL_PUBLIC_RELEASED = true;/);
  assert.match(router,/if \(!MURAL_PUBLIC_RELEASED\) \{/);
  assert.match(router,/nisti_list_mural_push_ready_v1/);
  assert.match(router,/broadcastMuralPush\(env,\{postId:Number\(id\),released:MURAL_PUBLIC_RELEASED\}\)/);
});

test('automatic Mural notices cover collection, product and notice after publish', () => {
  const router=read('src/mural-router.js');
  const worker=read('src/operator-audit-router.js');
  const push=read('src/web-push.js');
  assert.match(router,/await notifyMuralAfterPublication\(env, id\)/);
  assert.match(router,/await notifyMuralAfterPublication\(env, Number\(value\.id\)\)/);
  assert.match(router,/await notifyMuralAfterPublication\(env, postId\)/);
  assert.match(router,/nisti_list_mural_push_ready_v1/);
  assert.match(worker,/async scheduled\(_event, env, ctx\)/);
  assert.match(worker,/dispatchScheduledMuralNotifications\(env\)/);
  assert.match(push,/kind === 'collection' \? 'Nova coleção'/);
  assert.match(push,/kind === 'product' \? 'Novo produto'/);
  assert.match(push,/url: `\/#\/mural\/post\/\$\{id\}`/);
});

test('database jobs only include recent published, unexpired material, retry failed only', () => {
  const sql=read('supabase/migrations/20261015_mural_scheduled_push_delivery_v2.sql');
  assert.match(sql,/status='published'/);
  assert.match(sql,/published_at<=now\(\)/);
  assert.match(sql,/published_at>=now\(\)-interval '2 hours'/);
  assert.match(sql,/expires_at IS NULL OR p\.expires_at>now\(\)/);
  assert.match(sql,/state IN \('claimed','sent'\)/);
  assert.match(sql,/attempts<3/);
  assert.match(sql,/state='failed'/);
  assert.match(sql,/interval '10 minutes'/);
  assert.match(sql,/TO service_role/);
  assert.match(read('wrangler.toml'),/crons = \["\*\/5 \* \* \* \*"\]/);
  assert.match(read('src/mural-router.js'),/const MURAL_PUBLIC_RELEASED = true;/);
  const release=read('supabase/migrations/20261015_mural_public_release_cutoff_v1.sql');
  assert.match(release,/CREATE TABLE IF NOT EXISTS public.mural_push_release_gate/);
  assert.match(release,/p.published_at>=GREATEST/);
  assert.match(release,/SELECT released_at FROM public.mural_push_release_gate/);
});
