import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recordAdminActivityFromResponse } from '../src/system-notifications.js';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const cover = read('../src/cover-notifications.js');
const scoped = read('../supabase/migrations/20261009153500_notification_feed_scope_v1.sql');
const core = read('../src/core-router.js');
const sw = read('../public/sw.js');
const operatorApp = read('../src/public-main.jsx');

test('admin activity recording is not blocked by removed D1 binding', async () => {
  const request = new Request('https://nisti.example/api/notifications/unread-count');
  const response = Response.json({ ok:true });
  assert.equal(await recordAdminActivityFromResponse(request, response, {}), null);
  assert.doesNotMatch(read('../src/system-notifications.js'), /if \(!env\?\.DB/);
});

test('Supabase notification feed and unread count filter by audience before limiting', () => {
  assert.match(scoped, /WHEN p_user_id='__admin_system__'/);
  assert.match(scoped, /THEN n\.type<>'new_cover' AND LEFT\(n\.capa_code,7\)='__SYS__'/g);
  assert.match(scoped, /ELSE n\.type='new_cover'/g);
  assert.match(scoped, /REVOKE ALL ON FUNCTION public\.nisti_reserve_notifications_v1/);
  assert.match(scoped, /GRANT EXECUTE ON FUNCTION public\.nisti_reserve_unread_notifications_v1/);
  assert.match(cover, /supabaseReserveUnreadNotifications\(env, safeUserId\)/);
  assert.match(cover, /supabaseReserveUnreadNotifications\(env, ADMIN_SYSTEM_USER_ID\)/);
});

test('push activation only succeeds when the server confirms persistence', () => {
  assert.match(core, /success \? 200 : 400/);
  assert.match(operatorApp, /result\?\.ok !== true/);
  assert.match(operatorApp, /setPushStatus\('error'\)/);
});

test('push renewal does not discard the prior endpoint before saving the new one', () => {
  const register = sw.indexOf("const saved = await fetch('/api/push/subscribe'");
  const remove = sw.indexOf("await fetch('/api/push/unsubscribe'");
  assert.ok(register >= 0 && remove > register);
  assert.match(sw, /event\.newSubscription \|\|/);
  assert.match(sw, /operatorClient\.navigate\(target\)/);
});

test('operator push status verifies server registration and correct VAPID pairing', () => {
  const push = read('../src/web-push.js');
  assert.match(push, /export async function pushVapidHealth/);
  assert.match(push, /crypto\.subtle\.verify/);
  assert.match(push, /vapid_keys_mismatch/);
  assert.match(operatorApp, /await api\('\/api\/push\/status'/);
  assert.match(operatorApp, /!status\?\.registered \|\| !status\?\.vapid_ready/);
  assert.match(operatorApp, /Testar envio/);
});

test('push self-test is scoped to the signed operator and uses restricted database lookup', () => {
  const sql = read('../supabase/migrations/20261009155000_push_device_scope_v1.sql');
  const push = read('../src/web-push.js');
  const log = read('../src/system-notifications.js');
  assert.match(sql, /ps\.user_id = LEFT\(NULLIF\(BTRIM\(p_user_id\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.nisti_get_push_device_v1/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.nisti_get_push_device_v1.*TO service_role/);
  assert.match(core, /sendOperatorDevicePushTest\(env,userId,body\?\.endpoint\)/);
  assert.match(push, /nisti_get_push_device_v1/);
  assert.match(push, /code:'provider_accepted'/);
  assert.match(log, /pathname === '\/api\/push\/test'/);
});
