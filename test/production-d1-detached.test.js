import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const production=fs.readFileSync('wrangler.toml','utf8');
const compatibility=fs.readFileSync('wrangler.d1-compat.toml','utf8');
const gate=fs.readFileSync('.github/workflows/production-gate.yml','utf8');
const deploy=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');
const core=fs.readFileSync('src/core-router.js','utf8');
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));

test('production Worker is detached from Cloudflare D1',()=>{
  assert.doesNotMatch(production,/\[\[d1_databases\]\]/);
  assert.doesNotMatch(production,/binding\s*=\s*"DB"/);
  assert.match(production,/SUPABASE_READS_ENABLED = "1"/);
  assert.match(production,/SUPABASE_WRITE_MODE = "primary"/);
  assert.doesNotMatch(production,/SUPABASE_EMERGENCY_/);
});

test('legacy D1 remains available only through an explicit compatibility config',()=>{
  assert.match(compatibility,/\[\[d1_databases\]\]/);
  assert.match(compatibility,/binding = "DB"/);
  assert.match(compatibility,/database_name = "nisti-identificacao"/);
  assert.match(compatibility,/migrations_dir = "migrations"/);
});

test('CI and deploy D1 migration commands use the compatibility config',()=>{
  assert.match(gate,/--config wrangler\.d1-compat\.toml/);
  assert.match(deploy,/--local --config wrangler\.d1-compat\.toml/);
  assert.match(deploy,/--remote --config wrangler\.d1-compat\.toml/);
  assert.match(deploy,/run: npx wrangler deploy/);
});

test('public health endpoint does not expose D1 binding details',()=>{
  const start=core.indexOf("url.pathname === '/api/health'");
  const end=core.indexOf("url.pathname === '/api/sku/parse'",start);
  const block=core.slice(start,end);
  assert.match(block,/service:'nisti-identificacao'/);
  assert.doesNotMatch(block,/d1_binding_configured|compatibility_store|write_authority|primary:/);
});

test('manual legacy D1 migration script cannot use production Wrangler config',()=>{
  assert.match(pkg.scripts['db:migrate'],/--config wrangler\.d1-compat\.toml/);
});
