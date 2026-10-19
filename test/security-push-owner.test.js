import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync('src/core-router.js','utf8');
const push=fs.readFileSync('src/web-push.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261019235500_nisti_push_unsubscribe_ownership.sql','utf8');

test('operator unsubscribe requires server-verified session ID',()=>{
  const route=core.match(/if \(url\.pathname === '\/api\/push\/unsubscribe'[\s\S]{0,360}/)?.[0]||'';
  assert.match(route,/verifiedOperatorId\(request\)/);
  assert.match(route,/if\(!userId\).*401/);
  assert.match(route,/removeOwnPushSubscription\(env,userId,body\?\.endpoint\)/);
  assert.doesNotMatch(route,/removePushSubscription\(env,body/);
});

test('operator push deletion RPC compares both operator identity and endpoint',()=>{
  assert.match(sql,/WHERE user_id = BTRIM\(p_user_id\)/i);
  assert.match(sql,/AND endpoint = BTRIM\(p_endpoint\)/i);
  assert.match(sql,/SECURITY INVOKER/);
  assert.match(sql,/REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
  assert.match(push,/nisti_delete_operator_push_subscription_v1/);
  assert.match(push,/p_user_id:id/);
  assert.match(push,/p_endpoint:cleanEndpoint/);
});

test('automatic removal of dead subscriptions remains separate from operator unsubscribe',()=>{
  assert.match(push,/export async function removePushSubscription\(env, endpoint\)/);
  assert.match(push,/nisti_delete_push_subscription/);
  assert.match(push,/removePushSubscription\(env, target\.endpoint\)/);
});
