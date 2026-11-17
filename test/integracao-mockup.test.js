import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { autorizadaPelaChaveDoMockup } from '../src/core/integracao-mockup.js';

const CHAVE = 'k'.repeat(40);
const env = { MOCKUP_INTEGRATION_KEY: CHAVE };
const pedido = (metodo, caminho, auth) => new Request(`https://sistemanistiid.online${caminho}`, {
  method: metodo,
  headers: auth === undefined ? {} : { authorization: auth },
  body: metodo === 'POST' ? '{}' : undefined
});

test('a chave certa autoriza só POST /api/products', async () => {
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('POST', '/api/products', `Bearer ${CHAVE}`), env), true);
});

test('chave errada, ausente ou em formato estranho não autoriza', async () => {
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('POST', '/api/products', `Bearer ${CHAVE}x`), env), false);
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('POST', '/api/products', 'Bearer'), env), false);
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('POST', '/api/products', CHAVE), env), false);
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('POST', '/api/products'), env), false);
});

test('a chave não vale para outras rotas nem outros métodos', async () => {
  const auth = `Bearer ${CHAVE}`;
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('GET', '/api/products', auth), env), false);
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('DELETE', '/api/products', auth), env), false);
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('POST', '/api/products/12', auth), env), false);
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('POST', '/api/products/12/image', auth), env), false);
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('POST', '/api/admin/commerce/qualquer', auth), env), false);
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('POST', '/api/sku/x', auth), env), false);
});

test('sem chave no servidor, ou com chave curta, a integração fica desligada', async () => {
  const auth = `Bearer ${CHAVE}`;
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('POST', '/api/products', auth), {}), false);
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('POST', '/api/products', 'Bearer curta'), { MOCKUP_INTEGRATION_KEY: 'curta' }), false);
  assert.equal(await autorizadaPelaChaveDoMockup(pedido('POST', '/api/products', 'Bearer '), { MOCKUP_INTEGRATION_KEY: '' }), false);
});

test('o roteador exige sessão OU a chave, sem abrir mais nada', () => {
  const router = fs.readFileSync(new URL('../src/edge-router.js', import.meta.url), 'utf8');
  assert.match(router, /isProtectedApi\(pathname\) && !\(await validSession\(request, env\)\) && !\(await autorizadaPelaChaveDoMockup\(request, env\)\)/);
  assert.equal(router.split('autorizadaPelaChaveDoMockup(').length - 1, 1);
});

test('a chave nunca aparece em arquivo versionado', () => {
  const wrangler = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.doesNotMatch(wrangler, /MOCKUP_INTEGRATION_KEY\s*=/);
});
