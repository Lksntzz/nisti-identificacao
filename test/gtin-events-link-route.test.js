import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const view = read('src/admin/GtinEventsView.jsx');
const gtinRouter = read('src/gtin-router.js');
const main = read('src/main.jsx');

test('vincular EAN não cadastrado usa a rota que o servidor realmente atende', () => {
  assert.match(view, /api\(`\/api\/products\/\$\{selectedProductId\}\/gtins`/);
  assert.doesNotMatch(view, /\/api\/admin\/products\//);
  assert.match(gtinRouter, /pathname\.match\(\/\^\\\/api\\\/products\\\/\(\\d\+\)\\\/gtins\$\/\)/);
});

test('api() do admin não aceita página HTML como sucesso de rota /api', () => {
  assert.match(main, /if \(!data && response\.status !== 204 && String\(path\)\.startsWith\('\/api\/'\)\)/);
});

test('rota pública não usada de gravação de leituras foi removida', () => {
  assert.doesNotMatch(gtinRouter, /pathname === '\/api\/gtin-events' && request\.method === 'POST'/);
});
