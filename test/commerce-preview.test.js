import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('preview do Worker habilita commit somente no sandbox comercial isolado', () => {
  const config = read('wrangler.preview.toml');
  const router = read('src/commerce-admin-router.js');
  const rpc = read('src/commerce-rpc.js');

  assert.equal(config.includes('preview_urls = true'), true);
  assert.equal(config.includes('APP_ENV = "preview"'), true);
  assert.equal(config.includes('COMMERCE_DATA_SCOPE = "preview"'), true);
  assert.equal(config.includes('COMMERCE_COMMIT_ENABLED = "1"'), true);
  assert.equal(rpc.includes("appEnv === 'preview' && scope !== 'preview'"), true);
  assert.equal(rpc.includes('Worker preview não pode acessar o Catálogo Comercial live.'), true);
  assert.equal(router.includes("env?.COMMERCE_COMMIT_ENABLED"), true);
  assert.equal(router.includes("technical_error: 'commerce_commit_disabled'"), true);
});

test('workflow de preview apenas envia nova versão e não faz deploy de produção', () => {
  const workflow = read('.github/workflows/commerce-preview.yml');

  assert.equal(workflow.includes('wrangler versions upload'), true);
  assert.equal(workflow.includes('--config wrangler.preview.toml'), true);
  assert.equal(workflow.includes('github.head_ref == \'feat/catalogo-comercial-v1\''), true);
  assert.equal(workflow.includes('wrangler deploy'), false);
});
