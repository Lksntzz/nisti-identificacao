import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const ui=fs.readFileSync('src/commerce-sales-evolution.jsx','utf8');
const listing=fs.readFileSync('src/commerce-evolution-zero-listings.jsx','utf8');
const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const styles=fs.readFileSync('src/commerce-evolution-polish.css','utf8');

test('ZERO status is obtained from verified full advertisement, never an unsold SKU',()=>{
  const evolution=store.slice(store.indexOf('export async function commerceSalesEvolution'),
    store.indexOf('export async function commerceListingManagerMonthly'));
  assert.match(evolution,/const onlyListings=status==='ZERO'/);
  assert.match(evolution,/commerceListingManager\(env,\{/);
  assert.match(evolution,/status:'ZERO',curve:'ALL',basis:'UNITS'/);
  assert.match(evolution,/p_status:onlyListings\?'ALL':status/);
  assert.match(evolution,/Promise\.allSettled\(\[listingRequest,trendRequest\]\)/);
  assert.match(evolution,/const samePeriod=listing&&trend&&listing\.period_start&&listing\.period_end/);
  assert.match(evolution,/listing\.period_start===trend\.period_start/);
  assert.match(evolution,/grain:'LISTING'/);
  assert.match(evolution,/grain:'SKU'/);
  assert.match(evolution,/zero:onlyListings\|\|samePeriod\?confirmedZero:null/);
  assert.doesNotMatch(evolution,/some\([^)]*model_key[^)]*current_units=0/);
});

test('selected Sem vendas view renders only verified full listing IDs and totals',()=>{
  assert.match(ui,/data\?\.grain==='LISTING'\?<>\s*<div className="nim-evolution-results-head">/);
  assert.match(ui,/CommerceEvolutionZeroListings items=\{rows\.filter\(item=>/);
  assert.match(ui,/item\.ready===true&&item\.situation==='ZERO'&&Number\(item\.units\)===0/);
  assert.match(ui,/anúncio\(s\) inteiro\(s\) sem vendas confirmadas/);
  assert.match(ui,/nenhuma unidade vendida em/);
  assert.doesNotMatch(ui,/Este resultado não garante que o anúncio inteiro ficou sem vendas/);
  assert.match(listing,/item\.external_listing_id/);
  assert.match(listing,/item\.title/);
  assert.doesNotMatch(listing,/item\.sku|item\.model_key|SKU \/ Anúncio/);
  assert.match(listing,/target="_blank" rel="noopener noreferrer"/);
  assert.match(styles,/\.nim-evolution-zero-listing/);
});

test('other sales situations and original SKU evidence remain unchanged',()=>{
  assert.match(ui,/const statuses=\[\['ZERO','Sem vendas'\],\['STABLE','Estável'\],\['RISING','Crescimento'\]\]/);
  assert.match(ui,/data\?\.grain==='LISTING'\?<>\s*<div/);
  assert.match(ui,/SKU\(s\)\/modelo\(s\) no filtro/);
  assert.match(ui,/const sharedSku=item\.source==='SHOPEE'&&listingIds\.length>1/);
  const newView=fs.readFileSync('src/commerce-evolution-integrated.jsx','utf8');
  assert.match(manager,/CommerceEvolutionIntegrated/);
  assert.match(newView,/const STATUS=\[\['ZERO','Sem vendas'\],\['STABLE','Estável'\],\['RISING','Crescimento'\]\]/);
  assert.match(newView,/onStatusChange\(card\.id\)/);
});
