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

test('Painel de saúde descreve somente a infraestrutura do fluxo EAN', () => {
  const source = read('src/system-health-view.jsx');
  assert.equal(source.includes('Saúde do Sistema EAN'), true);
  assert.equal(source.includes('Fluxo principal sem dependência de IA'), true);
  assert.equal(source.includes('Reindexar Vectorize'), false);
  assert.equal(source.includes('Atividade de IA hoje'), false);
});

test('Ferramentas visuais antigas não são renderizadas no AdminApp EAN', () => {
  const source = read('src/main.jsx');
  assert.equal(source.includes("activeView === 'shadow-observability'"), false);
  assert.equal(source.includes('<GeometricShadowObservability embedded />'), false);
  assert.equal(source.includes('<GtinRegistryView />'), true);
  assert.equal(source.includes('<GtinEventsView'), true);
});

test('Shadow suporta modo embedded sem backlink administrativo redundante', () => {
  const source = read('src/geometric-shadow-observability.jsx');
  assert.equal(source.includes('({ embedded = false })'), true);
  assert.equal(source.includes("embedded ? 'embedded' : ''"), true);
  assert.equal(source.includes('!embedded && <a className="shadow-back-link"'), true);
});
