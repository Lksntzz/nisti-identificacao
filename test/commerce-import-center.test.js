import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Catálogo Comercial usa a nova Central de Importações', () => {
  const app = read('src/commerce-admin-app-v2.jsx');
  assert.equal(app.includes("CommerceImportCenter"), true);
  assert.equal(app.includes("Central de Importações"), true);
  assert.equal(app.includes("<CommerceUnifiedImportView"), false);
  assert.equal(app.includes("id: 'imports'"), false);
  assert.equal(app.includes("id: 'import-center'"), true);
});

test('Central de Importações é um componente próprio e separado da tela antiga', () => {
  const center = read('src/commerce-import-center.jsx');
  assert.equal(center.includes("commerce-unified-import-view"), false);
  assert.equal(center.includes("CommerceImportView"), false);
  assert.equal(center.includes("CommerceSalesImportPanel"), false);
  assert.equal(center.includes("Importar catálogo"), true);
  assert.equal(center.includes("Importar vendas"), true);
  assert.equal(center.includes("Últimas importações"), true);
  assert.equal(center.includes("Resumo"), true);
  assert.equal(center.includes("Revisão do lote"), true);
  assert.equal(center.includes("Conferência antes de enviar"), true);
});

test('Nova Central suporta as plataformas comerciais do catálogo', () => {
  const center = read('src/commerce-import-center.jsx');
  for (const platform of ['SHOPEE','MERCADO_LIVRE','AMAZON','SHEIN','LOJA_INTEGRADA','KWAI','TIKTOK','ALIEXPRESS','MAGALU']) {
    assert.equal(center.includes(platform), true, platform);
  }
});
