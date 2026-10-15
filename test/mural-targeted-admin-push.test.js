import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('A notificação de teste tem apenas o destinatário ADM Lukas, com bloqueio de repetição', () => {
  const sql = read('supabase/migrations/20261015_mural_targeted_test_push_v1.sql');
  assert.match(sql, /upper\(btrim\(g\.operator_name\)\)='ADM LUKAS'/);
  assert.match(sql, /count\(distinct s\.user_id\)/);
  assert.match(sql, /v_operator_count<>1/);
  assert.match(sql, /order by updated_at desc,id desc limit 1/);
  assert.match(sql, /interval '90 seconds'/);
  assert.match(sql, /on conflict\(user_id\) do update/);
  assert.match(sql, /to service_role/);
  assert.match(sql, /from public,anon,authenticated/);
});

test('O endpoint para o teste é protegido como API administrativa e não libera o Mural', () => {
  const edge = read('src/edge-router.js');
  const router = read('src/mural-router.js');
  const push = read('src/web-push.js');
  assert.match(edge, /pathname\.startsWith\('\/api\/admin\/'\)/);
  assert.match(edge, /isProtectedApi\(pathname\) && !\(await validSession/);
  assert.match(router, /\/api\/admin\/mural\/push\/test-adm-lukas/);
  assert.match(router, /const MURAL_PUBLIC_RELEASED = false/);
  assert.match(push, /export async function sendAdmLukasMuralTestPush/);
  assert.match(push, /nisti_claim_adm_lukas_mural_push_test_v1/);
  assert.match(push, /channel: 'mural'/);
  assert.match(push, /mural_kind: 'test'/);
  assert.match(push, /url: '\/#scanner'/);
  assert.match(push, /await sendWebPushNotification\(env, claim\.subscription, payload\)/);
  assert.doesNotMatch(push.slice(push.indexOf('export async function sendAdmLukasMuralTestPush'), push.indexOf('async function loadPushSubscriptions')), /broadcastMuralPush\(/);
});

test('O operador não recebe push sem ação explícita de confirmação no painel administrativo', () => {
  const panel = read('src/admin/MuralNistiAdminView.jsx');
  assert.match(panel, /testAdmLukasMuralPush/);
  assert.match(panel, /window\.confirm\('Enviar UMA notificação de teste/);
  assert.match(panel, /\/api\/admin\/mural\/push\/test-adm-lukas/);
  assert.match(panel, /muralPushTestBusy/);
  assert.match(panel, /Serviço push aceitou o envio/);
  assert.match(panel, /Testar push · ADM Lukas/);
});
