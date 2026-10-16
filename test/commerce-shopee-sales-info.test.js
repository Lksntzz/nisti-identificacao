import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  looksLikeShopeeSalesInfo,detectShopeeSalesInfo,parseShopeeSalesInfo,attestShopeeActiveExport
} from '../src/commerce-shopee-sales-info.js';

const header=[
  'et_title_product_id','et_title_product_name','et_title_variation_id',
  'et_title_variation_name','et_title_parent_sku','et_title_variation_sku',
  'et_title_variation_price','ps_gtin_code','et_title_variation_stock','et_title_reason'
];
const metadata=['sales_info','checksum','0','376221706','{}'];
const labels=['ID do Produto','Nome do Produto','Variante Identificador','Nome',
  'SKU de referência','SKU','Preço','GTIN (EAN)','Estoque do Vendedor','Motivo da Falha'];
const row=(id,title,variationId,variation,parent,sku,price='49.90',ean='7898764982617',stock='12')=>
  [id,title,variationId,variation,parent,sku,price,ean,stock,''];
const workbook=records=>[header,metadata,labels,[],[],[],...records];

test('reconhece cabeçalho técnico, ignora instruções e preserva ID e variação da Shopee',()=>{
  const data=workbook([
    row('12345678900','Caderneta de Vacinação Infantil','98765432101','CAPA 1','SKU_PAI','SKU_CAPA1'),
    row('12345678900','Caderneta de Vacinação Infantil','98765432102','CAPA 2','','SKU_CAPA2'),
    row('12345678901','Planner Semanal 2027','98765432103','','SKU_SOLO','')
  ]);
  assert.equal(looksLikeShopeeSalesInfo(data),true);
  assert.equal(detectShopeeSalesInfo(data),true);
  const parsed=parseShopeeSalesInfo(data,'Produtos');
  assert.equal(parsed.format,'SHOPEE_SALES_INFO');
  assert.equal(parsed.source_account_id,'376221706');
  assert.deepEqual(parsed.summary,{listing_count:2,variation_count:3,missing_sku_rows:0});
  assert.equal(parsed.rows.length,3);
  assert.equal(parsed.rows[0].row_number,7);
  assert.equal(parsed.rows[0].normalized.external_listing_id,'12345678900');
  assert.equal(parsed.rows[0].normalized.source_variation_id,'98765432101');
  assert.equal(parsed.rows[0].normalized.sku_primary,'SKU_CAPA1');
  assert.equal(parsed.rows[0].normalized.sku_secondary,null);
  assert.equal(parsed.rows[1].normalized.source_parent_sku,'SKU_PAI');
  assert.equal(parsed.rows[1].normalized.sku_primary,'SKU_CAPA2');
  assert.equal(parsed.rows[2].normalized.sku_primary,'SKU_SOLO');
  assert.equal(parsed.rows[2].normalized.observed_year,2027);
  assert.equal(parsed.rows[0].normalized.category,'Caderneta de Vacinação');
  assert.equal(parsed.rows[0].normalized.listing_url,'https://shopee.com.br/product/376221706/12345678900');
  assert.equal(parsed.rows[0].normalized.source_listing_status,'UNKNOWN');
});

test('SKU pai NÃO vira SKU de variação quando anúncio tem mais de uma variação',()=>{
  const data=workbook([
    row('20000000000','Caderno Personalizado','31000000001','CAPA 1','SKU_PAI',''),
    row('20000000000','Caderno Personalizado','31000000002','CAPA 2','','SKU_CAPA2'),
    row('30000000000','Agenda Simples','41000000001','','SKU_SOLO','')
  ]);
  const parsed=parseShopeeSalesInfo(data,'Produtos');
  assert.equal(parsed.rows[0].normalized.sku_primary,null);
  assert.equal(parsed.rows[0].parser_status,'INVALID');
  assert.deepEqual(parsed.rows[0].issues,['missing_variation_sku']);
  assert.equal(parsed.rows[1].normalized.sku_primary,'SKU_CAPA2');
  assert.equal(parsed.rows[2].normalized.sku_primary,'SKU_SOLO');
  assert.equal(parsed.summary.missing_sku_rows,1);
});

test('registros sem SKU ficam inválidos para revisão e não criam identidades fictícias',()=>{
  const parsed=parseShopeeSalesInfo(workbook([
    row('30000000000','Caderno Básico','50000000001','','','')
  ]),'Produtos');
  assert.equal(parsed.rows[0].parser_status,'INVALID');
  assert.equal(parsed.rows[0].normalized.external_listing_id,'30000000000');
  assert.equal(parsed.rows[0].normalized.sku_primary,null);
});

test('não duplica variações com mesmo ID e nunca usa o estoque como status',()=>{
  const parsed=parseShopeeSalesInfo(workbook([
    row('40000000000','Agenda','60000000001','A','','SKU_A','49.90','00','0'),
    row('40000000000','Agenda','60000000001','B','','SKU_B')
  ]),'Produtos');
  assert.equal(parsed.rows[1].parser_status,'INVALID');
  assert.ok(parsed.rows[1].issues.includes('duplicate_shopee_variation_id'));
  assert.equal(parsed.rows[0].normalized.source_stock,'0');
  assert.equal(parsed.rows[0].normalized.source_ean,null);
  assert.equal(parsed.rows[0].normalized.source_listing_status,'UNKNOWN');
});

test('só marca anúncios ativos após confirmação e sem mutar o arquivo lido',()=>{
  const parsed=parseShopeeSalesInfo(workbook([
    row('40000000000','Agenda','60000000001','A','','SKU_A')
  ]),'Produtos');
  assert.equal(parsed.rows[0].normalized.source_listing_status,'UNKNOWN');
  const confirmed=attestShopeeActiveExport(parsed);
  assert.equal(confirmed.rows[0].normalized.source_listing_status,'ACTIVE');
  assert.equal(confirmed.rows[0].normalized.source_status_evidence,'OPERATOR_CONFIRMED_ACTIVE_EXPORT');
  assert.equal(parsed.rows[0].normalized.source_listing_status,'UNKNOWN');
  assert.throws(()=>attestShopeeActiveExport({format:'OTHER'}),/aplicável apenas/);
});

test('bloqueia metadados inválidos e cabeçalhos incompletos',()=>{
  const data=workbook([row('40000000000','Agenda','60000000001','A','','SKU_A')]);
  data[1][3]='';
  assert.throws(()=>parseShopeeSalesInfo(data,'Produtos'),/ID da loja/);
  data[1][3]='376221706';
  data[0][0]='et_title_nonexistent';
  assert.throws(()=>parseShopeeSalesInfo(data,'Produtos'),/faltam colunas/);
});

test('leitor e painel de importação integram o formato com confirmação explícita',()=>{
  const reader=fs.readFileSync('src/commerce-xlsx-reader.js','utf8');
  const ui=fs.readFileSync('src/commerce-import-center.jsx','utf8');
  assert.match(reader,/looksLikeShopeeSalesInfo\(data\)/);
  assert.match(reader,/parseShopeeSalesInfo\(data, sheetName\)/);
  assert.match(reader,/format: officialShopee\.format/);
  assert.match(ui,/attestShopeeActiveExport\(catalogParsed\)/);
  assert.match(ui,/checked=\{shopeeActiveConfirmed\}/);
  assert.match(ui,/!shopeeActiveConfirmed/);
  assert.match(ui,/setShopeeActiveConfirmed\(false\)/);
});
