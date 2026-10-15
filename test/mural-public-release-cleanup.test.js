import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = file => fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');

test('Mural is released to the operator app and links open only published posts',()=>{
  const router=source('src/mural-router.js');
  const app=source('src/public-main.jsx');
  assert.match(router,/const MURAL_PUBLIC_RELEASED = true;/);
  assert.match(router,/released: MURAL_PUBLIC_RELEASED/);
  assert.match(router,/mp.status='published'/);
  assert.match(router,/!MURAL_PUBLIC_RELEASED && !qaAuthorized/);
  assert.match(app,/Boolean\(data\?\.released \|\| \(qaRequested && data\?\.qa\)\)/);
  assert.match(app,/<MuralNisti onUnreadChange=\{setMuralUnread\} \/>/);
  assert.match(app,/onOpenMural=\{\(\) => setPublicView\('mural'\)\}/);
});

test('all real Mural push infrastructure remains while every test action was removed',()=>{
  const app=source('src/public-main.jsx');
  const admin=source('src/admin/MuralNistiAdminView.jsx');
  const router=source('src/mural-router.js');
  const core=source('src/core-router.js');
  const sender=source('src/web-push.js');
  const sw=source('public/sw.js');
  assert.doesNotMatch(app,/testThisDevicePush|testLocalNotification|pushTestMessage|Testar exibição|Testar push/);
  assert.doesNotMatch(admin,/mural-adm-test-push|testAdmLukasMuralPush|Testar push · ADM Lukas/);
  assert.doesNotMatch(router,/test-adm-lukas|sendAdmLukasMuralTestPush/);
  assert.doesNotMatch(core,/test-my-device|test-receipt|test-result|sendMuralPushSelfTest/);
  assert.doesNotMatch(sender,/sendMuralPushSelfTest|sendAdmLukasMuralTestPush|push_test_id/);
  assert.doesNotMatch(sw,/nisti-local-notification-test|test-receipt|push_test_id/);
  assert.match(core,/\/api\/push\/subscribe/);
  assert.match(sender,/export async function broadcastMuralPush/);
  assert.match(sw,/self\.registration\.showNotification\(title, options\)/);
});

test('launch cutoff protects the production Mural from pre-release notification backlog',()=>{
  const sql=source('supabase/migrations/20261015_mural_public_release_cutoff_v1.sql');
  const cleanup=source('supabase/migrations/20261015_remove_push_qa_only_tables_v1.sql');
  assert.match(sql,/CREATE TABLE IF NOT EXISTS public.mural_push_release_gate/);
  assert.match(sql,/released_at timestamptz NOT NULL/);
  assert.match(sql,/ON CONFLICT\(id\) DO NOTHING/);
  assert.match(sql,/p.published_at>=GREATEST/);
  assert.match(sql,/SELECT released_at FROM public.mural_push_release_gate/);
  assert.match(cleanup,/DROP TABLE IF EXISTS public.operator_push_test_receipts/);
  assert.match(cleanup,/DROP TABLE IF EXISTS public.mural_push_test_cooldowns/);
  assert.doesNotMatch(cleanup,/DROP TABLE IF EXISTS public.push_subscriptions/);
  assert.doesNotMatch(cleanup,/DROP TABLE IF EXISTS public.mural_push_deliveries/);
});
