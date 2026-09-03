import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_MENU_SECTIONS,
  REMOVED_ADMIN_NAV_IDS
} from '../src/admin-navigation.js';

function flattenedItems() {
  return ADMIN_MENU_SECTIONS.flatMap(section => section.items || []);
}

test('Admin navigation exposes only operationally useful tools', () => {
  const items = flattenedItems();
  const ids = items.map(item => item.id);

  assert.deepEqual(ids, [
    'catalogo',
    'usuarios',
    'historico',
    'nao-identificados',
    'shadow-observability',
    'verificar',
    'logs'
  ]);
  assert.equal(new Set(ids).size, ids.length);
});

test('Admin navigation does not reintroduce removed duplicate/dead entries', () => {
  const ids = new Set(flattenedItems().map(item => item.id));
  for (const removedId of REMOVED_ADMIN_NAV_IDS) {
    assert.equal(ids.has(removedId), false, `${removedId} não deve voltar ao menu ADM`);
  }
});

test('Operator identification remains a utility outside the admin tool menu', () => {
  const hrefs = flattenedItems().map(item => item.href).filter(Boolean);
  assert.equal(hrefs.includes('/'), false);
  assert.equal(
    flattenedItems().find(item => item.id === 'shadow-observability')?.href,
    '/admin/shadow-observability'
  );
});

test('Admin navigation keeps catalog, correction, audit, AI quality and health capabilities', () => {
  const labels = new Set(flattenedItems().map(item => item.label));
  for (const expected of [
    'Catálogo de Produtos',
    'Ocorrências & Operadores',
    'Histórico de Identificações',
    'Falhas de Identificação',
    'Observabilidade IA',
    'Testar Reconhecimento',
    'Saúde & Logs'
  ]) {
    assert.equal(labels.has(expected), true, `${expected} deve permanecer disponível`);
  }
});

test('Admin source has no legacy duplicate navigation or dead PlatformsView', () => {
  const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');

  for (const forbidden of [
    "id: 'identificacao'",
    "id: 'similares'",
    "id: 'cadastrar'",
    "id: 'importar'",
    "id: 'plataformas'",
    "id: 'configuracoes'",
    'function PlatformsView',
    "activeView === 'similares'",
    "activeView === 'plataformas'",
    "activeView === 'configuracoes'",
    "import { createRoot } from 'react-dom/client';"
  ]) {
    assert.equal(source.includes(forbidden), false, `código morto ainda presente: ${forbidden}`);
  }

  assert.equal(source.includes("import { ADMIN_MENU_SECTIONS } from './admin-navigation.js';"), true);
  assert.equal(source.includes('Abrir NISTI ID'), true);
});
