import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceDataScope, commerceRpcName } from '../src/commerce-rpc.js';

test('preview roteia RPC comercial para namespace commerce_preview_', () => {
  const env = { APP_ENV: 'preview', COMMERCE_DATA_SCOPE: 'preview' };
  assert.equal(commerceDataScope(env), 'preview');
  assert.equal(
    commerceRpcName(env, 'commerce_dashboard_v1'),
    'commerce_preview_dashboard_v1'
  );
});

test('produção mantém RPC comercial live', () => {
  const env = { APP_ENV: 'production', COMMERCE_DATA_SCOPE: 'live' };
  assert.equal(commerceDataScope(env), 'live');
  assert.equal(commerceRpcName(env, 'commerce_dashboard_v1'), 'commerce_dashboard_v1');
});

test('preview falha fechada se tentar apontar para catálogo live', () => {
  assert.throws(
    () => commerceDataScope({ APP_ENV: 'preview', COMMERCE_DATA_SCOPE: 'live' }),
    /não pode acessar o Catálogo Comercial live/
  );
});

test('produção falha fechada se tentar apontar para sandbox', () => {
  assert.throws(
    () => commerceDataScope({ APP_ENV: 'production', COMMERCE_DATA_SCOPE: 'preview' }),
    /não pode acessar o sandbox comercial/
  );
});

test('escopo comercial desconhecido é rejeitado', () => {
  assert.throws(
    () => commerceDataScope({ COMMERCE_DATA_SCOPE: 'qualquer-coisa' }),
    /COMMERCE_DATA_SCOPE inválido/
  );
});
