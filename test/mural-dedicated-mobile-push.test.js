import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Mural push is enabled exclusively for released operator content', () => {
  const router = read('src/mural-router.js');
  const push = read('src/web-push.js');
  assert.match(router, /const MURAL_PUBLIC_RELEASED = true/);
  assert.match(router, /if \(!MURAL_PUBLIC_RELEASED\) return/);
  assert.match(router, /if \(!MURAL_PUBLIC_RELEASED\) \{/);
  assert.match(push, /if \(!released\) return \{ sent: 0, failed: 0, skipped: true, reason: 'mural_not_released' \}/);
  assert.match(router, /await broadcastMuralPush\(env, \{ postId, released: MURAL_PUBLIC_RELEASED \}\)/);
});

test('New collections, products, and notices get their own push path after publish', () => {
  const router = read('src/mural-router.js');
  const push = read('src/web-push.js');
  assert.match(router, /await notifyMuralAfterPublication\(env, id\)/);
  assert.match(router, /await notifyMuralAfterPublication\(env, Number\(value\.id\)\)/);
  assert.match(router, /await notifyMuralAfterPublication\(env, postId\)/);
  assert.match(push, /kind === 'collection' \? 'Nova coleção'/);
  assert.match(push, /kind === 'product' \? 'Novo produto'/);
  assert.match(push, /'Novo aviso'/);
  assert.match(push, /channel: 'mural'/);
  assert.match(push, /url: `\/#\/mural\/post\/\$\{id\}`/);
});

test('Database claims deduplicate Mural pushes for each operator, never leak drafts', () => {
  const ledger = read('supabase/migrations/20261015_mural_push_deliveries_v1.sql');
  const lookup = read('supabase/migrations/20261015_mural_push_post_deeplink_v1.sql');
  assert.match(ledger, /primary key\(post_id,operator_user_id\)/);
  assert.match(ledger, /on conflict \(post_id,operator_user_id\) do nothing/);
  assert.match(ledger, /status='published'/);
  assert.match(ledger, /published_at<=now\(\)/);
  assert.match(ledger, /to service_role/);
  assert.match(lookup, /mp\.status='published'/);
  assert.match(lookup, /p_user_id/);
});

test('Push tap opens the specific published Mural post within gated operator app', () => {
  const worker = read('public/sw.js');
  const app = read('src/public-main.jsx');
  const mural = read('src/mural-nisti.jsx');
  const router = read('src/mural-router.js');
  assert.match(worker, /channel: data\.channel === 'mural'/);
  assert.match(worker, /mural-\$\{data\.mural_post_id\}/);
  assert.match(app, /hash\.startsWith\('#\/mural'\)/);
  assert.match(mural, /mural\/posts\/\$\{match\[1\]\}/);
  assert.match(router, /nisti_mural_notification_post_v1/);
  assert.match(router, /getMuralNotificationPost/);
  assert.match(router, /MURAL_PUBLIC_RELEASED &&/);
});
