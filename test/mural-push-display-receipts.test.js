import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const load = path => fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Device receipt requires verified session, nonce and matching owner',()=>{
  const core=load('src/core-router.js');
  const sql=load('supabase/migrations/20261015_mural_push_display_receipts.sql');
  assert.match(core,/\/api\/push\/test-receipt/);
  assert.match(core,/\/api\/push\/test-result/);
  assert.match(core,/verifiedOperatorId\(request\)/);
  assert.match(core,/nisti_ack_operator_push_test_v1/);
  assert.match(core,/nisti_get_operator_push_test_v1/);
  assert.match(sql,/WHERE test_id=p_test_id AND user_id=p_user_id/);
  assert.match(sql,/display_status='pending'/);
  assert.match(sql,/REVOKE EXECUTE ON FUNCTION public\.nisti_ack_operator_push_test_v1/);
  assert.match(sql,/TO service_role/);
});

test('Encrypted push has nonce and SW can acknowledge its own display result',()=>{
  const push=load('src/web-push.js'),sw=load('public/sw.js');
  assert.match(push,/const testId = crypto\.randomUUID\(\)/);
  assert.match(push,/nisti_open_operator_push_test_v1/);
  assert.match(push,/push_test_id:testId/);
  assert.match(sw,/await self\.registration\.showNotification\(title, options\)/);
  assert.match(sw,/data\.mural_kind === 'test'/);
  assert.match(sw,/\/api\/push\/test-receipt/);
  assert.match(sw,/display_status:displayStatus/);
  assert.match(sw,/nisti-local-notification-test/);
  assert.match(sw,/port\?\.postMessage\(\{ok:true\}\)/);
});

test('Operator can distinguish push accepted from actual SW notification display',()=>{
  const app=load('src/public-main.jsx'),router=load('src/mural-router.js');
  assert.match(app,/Aguardando confirmação do aplicativo no celular/);
  assert.match(app,/displayStatus === 'shown'/);
  assert.match(app,/displayStatus === 'failed'/);
  assert.match(app,/Testar exibição/);
  assert.match(app,/registration\.active\.postMessage/);
  assert.match(router,/MURAL_PUBLIC_RELEASED = false/);
});
