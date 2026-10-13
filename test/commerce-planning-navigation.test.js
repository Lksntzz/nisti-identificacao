import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app=fs.readFileSync(new URL('../src/commerce-admin-app-v2.jsx',import.meta.url),'utf8');
const products=fs.readFileSync(new URL('../src/commerce-products-view.jsx',import.meta.url),'utf8');

test('production commerce navigation exposes NISTI product planning',()=>{
  assert.match(app,/import CommerceProductsView from '\.\/commerce-products-view\.jsx'/);
  assert.match(app,/id: 'planning', label: 'Planejamento de Produtos'/);
  assert.match(app,/activeView === 'planning' && <CommerceProductsView \/>/);
  assert.match(app,/planning: 'Planejamento de Produtos NISTI'/);
  assert.match(products,/SalesPlanningCard/);
  assert.match(products,/products\/sales-planning/);
});
