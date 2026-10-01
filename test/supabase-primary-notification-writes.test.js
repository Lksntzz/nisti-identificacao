import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../src/cover-notifications.js',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261001203000_primary_notification_writes_v1.sql',import.meta.url),'utf8');

test('notification writers bypass D1 in Supabase primary mode',()=>{
  for(const rpc of ['nisti_record_new_cover_notification_v1','nisti_update_notification_image_v1',
    'nisti_mark_notification_read_v1','nisti_mark_all_notifications_read_v1',
    'nisti_record_admin_system_notification_v1']) assert.ok(source.includes(rpc));
  assert.ok(source.includes('supabasePrimaryWritesRequested(env)'));
});

test('notification RPCs are invoker-only and service-role-only',()=>{
  assert.ok(!sql.includes('SECURITY DEFINER'));
  for(const name of ['nisti_record_new_cover_notification_v1','nisti_update_notification_image_v1',
    'nisti_mark_notification_read_v1','nisti_mark_all_notifications_read_v1',
    'nisti_record_admin_system_notification_v1']) {
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`));
  }
});
