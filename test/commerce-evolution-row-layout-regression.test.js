import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const base=fs.readFileSync('src/commerce-ad-manager.css','utf8');
const layout=fs.readFileSync('src/commerce-approved-layout.css','utf8');
const polish=fs.readFileSync('src/commerce-reactbits-lucide.css','utf8');
const panel=fs.readFileSync('src/commerce-sales-evolution.jsx','utf8');

test('rows use six-column grid, not flex, and do not render a second disclosure marker',()=>{
  const rules=[...base.matchAll(/\.nim-evolution-product-head\s*\{([^}]*)\}/g)].map(x=>x[1]);
  assert.ok(rules.length>=2);
  assert.ok(rules.some(css=>/display:grid/.test(css)));
  assert.ok(rules.every(css=>!/display:flex|flex-wrap:wrap/.test(css)));
  assert.match(layout,/\.nim-manager \.nim-evolution-table-head,\.nim-manager \.nim-evolution-product-head\{\s*display:grid/);
  assert.match(polish,/\.nim-manager \.nim-evolution-product-head\{\s*display:grid/);
  assert.match(polish,/\.nim-manager \.nim-evolution-product-head::before\{content:none;display:none\}/);
  assert.match(panel,/<CommercialIcon name="chevron-right"/);
  assert.doesNotMatch(base,/\.nim-evolution-product-head::before\{content:'[▸▾]'/);
});

test('expanded row contains a full product name, sales comparison and commercial advice',()=>{
  assert.match(panel,/className="nim-evolution-detail"/);
  assert.match(panel,/className="nim-evolution-detail-heading"/);
  assert.match(panel,/DETALHAMENTO DO PRODUTO/);
  assert.match(panel,/item\.title\|\|'Produto vendido na plataforma'/);
  assert.match(panel,/Comparação de \{days\} dias por SKU\/modelo/);
  assert.match(panel,/className="nim-evolution-product-stats"/);
  assert.match(panel,/className="nim-evolution-bars"/);
  assert.match(panel,/Ação comercial sugerida/);
  assert.match(panel,/IDs dos anúncios: \{listingIds\.join\(' · '\)\}/);
  assert.match(polish,/@media\(max-width:700px\)/);
  assert.match(polish,/\.nim-manager \.nim-evolution-detail \.nim-evolution-product-stats\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
