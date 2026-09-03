import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('Saúde & Logs não usa mais o painel legado com quotas inventadas', () => {
  const source = read('src/main.jsx');
  assert.equal(source.includes('function SystemLogsView('), false);
  assert.equal(source.includes('<SystemHealthView'), true);
  assert.equal(source.includes('1.500 req/dia'), false);
  assert.equal(source.includes('100% Gratuito'), false);
});

test('Painel de saúde separa medição local de billing externo', () => {
  const source = read('src/system-health-view.jsx');
  assert.equal(source.includes('Sem números inventados de billing'), true);
  assert.equal(source.includes('Quota ativa não é estimada'), true);
  assert.equal(source.includes('Snapshot atual'), true);
  assert.equal(source.includes('billing real do Vectorize não é consultado'), true);
});

test('Observabilidade Shadow é renderizada dentro do AdminApp', () => {
  const source = read('src/main.jsx');
  assert.equal(source.includes("activeView === 'shadow-observability'"), true);
  assert.equal(source.includes('<GeometricShadowObservability embedded />'), true);
});

test('Shadow suporta modo embedded sem backlink administrativo redundante', () => {
  const source = read('src/geometric-shadow-observability.jsx');
  assert.equal(source.includes('({ embedded = false })'), true);
  assert.equal(source.includes("embedded ? 'embedded' : ''"), true);
  assert.equal(source.includes('!embedded && <a className="shadow-back-link"'), true);
});
