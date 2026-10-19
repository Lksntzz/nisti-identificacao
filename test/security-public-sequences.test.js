import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261019234500_public_sequence_least_privilege.sql','utf8');

test('sequences are no longer exposed to anon and authenticated',()=>{
  assert.match(sql,/c\.relkind='S'/);
  assert.match(sql,/n\.nspname='public'/);
  assert.match(sql,/REVOKE ALL PRIVILEGES ON SEQUENCE public\.%I FROM anon, authenticated/);
});

test('postgres-created future sequences inherit restricted ACL; supabase_admin requires owner action',()=>{
  assert.match(sql,/ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public/);
  assert.doesNotMatch(sql,/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/m);
  assert.match(sql,/authorized supabase_admin maintenance action/);
  assert.equal((sql.match(/REVOKE ALL ON SEQUENCES FROM anon, authenticated/g)||[]).length,1);
});

test('security migration does not mutate scanner/commerce tables or remove service_role grants',()=>{
  const actual=sql.replace(/^--.*$/gm,'');
  assert.doesNotMatch(actual,/\b(?:insert|update|delete|truncate|drop)\b/i);
  assert.doesNotMatch(actual,/\b(?:grant|revoke)[^;]*service_role\b/i);
  assert.doesNotMatch(actual,/\b(?:product_gtins|gtin_scan_events|commerce_listings|products)\b/i);
});
