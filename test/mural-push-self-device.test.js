import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const get = file => fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('personal push test preserves operator identity and isolation',()=>{
const backend=get('src/core-router.js'),push=get('src/web-push.js'),ui=get('src/public-main.jsx');
assert.match(backend,/sendMuralPushSelfTest\(env,userId,body\?\.endpoint\)/);
assert.match(push,/getOperatorPushDevice\(env, userId, rawEndpoint\)/);
assert.match(push,/nisti_claim_operator_push_self_test_v1/);
assert.match(ui,/Testar push/);
assert.match(ui,/Testar exibição/);
assert.match(ui,/\/api\/push\/test-result/);
assert.match(ui,/persistPushSubscription\(subscription\)/);
assert.match(get('src/mural-router.js'),/MURAL_PUBLIC_RELEASED = false/);
});
test('atomic 90-second cooldown is backend restricted',()=>{
const sql=get('supabase/migrations/20261015_mural_push_self_test_cooldown.sql');
assert.match(sql,/interval '90 seconds'/);
assert.match(sql,/on conflict \(user_id\) do update/);
assert.match(sql,/to service_role/);
});
