import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commerceImportNormalizerInternals,
  normalizeCommerceImportRow
} from '../src/commerce-import-normalizer.js';

const { normalizeVideoStatus, normalizeUpdateHint, extractExternalListingId } = commerceImportNormalizerInternals;

test('normaliza linha padrão da Shopee', () => {
  const result = normalizeCommerceImportRow({
    marketplace: 'SHOPEE',
    sheetName: 'Agendas',
    rowNumber: 2,
    row: [
      'AGMT26_FLWR_PXV',
      '',
      'Agenda 2026 para Agendamentos c/ Forma de Pagamento Flower',
      'Agenda',
      'sim',
      'não',
      'https://shopee.com.br/product/376221706/28620167974/'
    ]
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.normalized.sku_primary, 'AGMT26_FLWR_PXV');
  assert.equal(result.normalized.update_hint, 'UPDATED');
  assert.equal(result.normalized.video_status, 'ABSENT');
  assert.equal(result.normalized.external_listing_id, '28620167974');
  assert.equal(result.normalized.observed_year, 2026);
});

test('Mercado Livre Agenda preserva SKU secundário e extrai item_id vendedor', () => {
  const result = normalizeCommerceImportRow({
    marketplace: 'MERCADO_LIVRE',
    sheetName: 'Agendas',
    rowNumber: 2,
    row: [
      'AGMT26_CGLDN_PXP',
      'AGMT26_CGLDN_PXP',
      'Agenda Cabeleireira Agendamentos c/ Pagamento Golden Glamour',
      'Agenda',
      'S',
      'S',
      'https://www.mercadolivre.com.br/produto/up/MLBU2893301033?pdp_filters=item_id:MLB3931979517'
    ]
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.normalized.sku_secondary, 'AGMT26_CGLDN_PXP');
  assert.equal(result.normalized.external_listing_id, 'MLB3931979517');
  assert.equal(result.normalized.video_status, 'ACTIVE');
});

test('Mercado Livre Planner trata layout deslocado e referência textual como revisão', () => {
  const result = normalizeCommerceImportRow({
    marketplace: 'MERCADO_LIVRE',
    sheetName: 'Planner',
    rowNumber: 5,
    row: [
      'PLAN25_GNAT_PXP',
      'Nisti Print Planner Semanal Mensal Capa Dura Green Nature',
      'Planner',
      '',
      'S',
      'S/D',
      'Planner Visão Semanal Mensal Capa Dura Green Nature | Frete grátis'
    ]
  });

  assert.equal(result.status, 'REVIEW');
  assert.equal(result.normalized.product_name, 'Nisti Print Planner Semanal Mensal Capa Dura Green Nature');
  assert.equal(result.normalized.category, 'Planner');
  assert.equal(result.normalized.video_status, 'DISABLED');
  assert.equal(result.normalized.listing_url, null);
  assert.ok(result.issues.includes('listing_reference_not_url'));
});

test('Mercado Livre Caderno usa layout compacto de seis colunas', () => {
  const result = normalizeCommerceImportRow({
    marketplace: 'MERCADO_LIVRE',
    sheetName: 'Caderno',
    rowNumber: 2,
    row: [
      'CADCONF02',
      'Caderno De Pedidos Confeiteira - 200 Páginas Coloridas',
      'Caderno',
      'S',
      'S',
      'https://www.mercadolivre.com.br/caderno-de-pedidos/up/MLBU1721772218?pdp_filters=item_id:MLB2185595106'
    ]
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.normalized.sku_primary, 'CADCONF02');
  assert.equal(result.normalized.update_hint, 'UPDATED');
  assert.equal(result.normalized.external_listing_id, 'MLB2185595106');
});

test('status ambíguos das planilhas são normalizados sem perder sinal de revisão', () => {
  assert.equal(normalizeVideoStatus('sim/desa'), 'DISABLED');
  assert.equal(normalizeVideoStatus('sim (Desatualizado)'), 'DISABLED');
  assert.equal(normalizeUpdateHint('NÃO/CALÉN'), 'REVIEW');
  assert.equal(normalizeUpdateHint('n cadastrado'), 'NOT_LISTED');
});

test('extrator de ID não confunde código de catálogo MLBU com item vendedor MLB', () => {
  assert.equal(
    extractExternalListingId('MERCADO_LIVRE', 'https://www.mercadolivre.com.br/x/up/MLBU1234567890'),
    null
  );
  assert.equal(
    extractExternalListingId('MERCADO_LIVRE', 'https://produto.mercadolivre.com.br/MLB-2185265822-x-_JM'),
    'MLB2185265822'
  );
});
