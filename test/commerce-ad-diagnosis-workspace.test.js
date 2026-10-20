import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  adDiagnosisStatus,adPeriodValues,adMatchesFilter,adNoSalesVariantCount,
  diagnosisFromEvidence,percentChange
} from '../src/commerce-ad-diagnosis-model.js';
const view=fs.readFileSync('src/commerce-ad-diagnosis-workspace.jsx','utf8');
const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const model=fs.readFileSync('src/commerce-ad-diagnosis-model.js','utf8');
const css=fs.readFileSync('src/commerce-ad-diagnosis-workspace.css','utf8');
const daily=fs.readFileSync('supabase/migrations/20261020113000_commerce_listing_diagnosis_daily_v1.sql','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');

test('manter o dashboard unificado como primeira visão sem apagar as ferramentas anteriores',()=>{
  assert.match(manager,/useState\('DIAGNOSIS'\)/);
  assert.match(manager,/CommerceAdDiagnosisWorkspace revision=\{refresh\} salesRevision=\{salesRevision\}/);
  assert.match(manager,/CommerceSalesEvolution platform=\{platform\}/);
  assert.match(manager,/commercialView==='LISTINGS'/);
  assert.match(view,/Evolução de Anúncios/);
  assert.match(view,/Lista de Anúncios/);
  assert.match(view,/Diagnóstico principal/);
  assert.match(view,/Variações do anúncio/);
  assert.match(view,/Próximas ações recomendadas/);
});
test('períodos, plataforma, busca e filtros incluindo variação zero sem falso número',()=>{
  assert.match(view,/\[7,30,60,90\]/);
  assert.match(view,/'STABLE','Estáveis'/);
  assert.match(view,/'ZERO','Sem vendas'/);
  assert.match(view,/'SHOPEE','Shopee'/);
  assert.match(view,/Mês personalizado/);
  assert.match(view,/setDraft\(e\.target\.value\)/);
  assert.match(view,/fetchStableListings/);
  assert.match(view,/items\.filter\(item=>adMatchesFilter\(item,'STABLE'\)\)/);
  assert.match(view,/trafficCurrent\?\.visits/);
  assert.match(view,/reportMoney\(sales\.revenue\)/);
  assert.doesNotMatch(view,/dados fictícios|Math\.random|placeholderData|1234567890|1\.284 anúncios/i);
});
test('classificação de Shopee parcial não infere zero confirmado nem rateia anúncios',()=>{
  const item={source:'SHOPEE',ready:false,identified_units:null,identified_empty_variations:1,
    identified_trend:null};
  const state=adDiagnosisStatus(item);
  assert.equal(state.code,'PENDING');
  assert.equal(adMatchesFilter(item,'ZERO'),true);
  assert.equal(adPeriodValues(item).units,null);
  assert.equal(adNoSalesVariantCount(item),null);
  assert.match(model,/não ratear SKUs compartilhados/);
});
test('variação sem venda aparece mesmo quando anúncio possui vendas confirmadas',()=>{
  const item={source:'ML_ANTIGO',ready:true,variation_data_complete:true,
    units:23,prev_units:20,previous_ready:true,zero_variations:2};
  assert.equal(adMatchesFilter(item,'ZERO'),true);
  assert.equal(adNoSalesVariantCount(item),2);
});
test('tendência estável exige períodos anteriores completos e volume significativo',()=>{
  assert.equal(adDiagnosisStatus({ready:true,previous_ready:true,units:20,prev_units:21}).code,'LOW');
  assert.equal(adDiagnosisStatus({ready:true,previous_ready:true,units:100,prev_units:95}).code,'STABLE');
  assert.equal(adDiagnosisStatus({ready:true,previous_ready:false,units:100,prev_units:95}).code,'PENDING');
  assert.equal(adDiagnosisStatus({ready:true,previous_ready:true,units:14,prev_units:30}).code,'FALLING');
  assert.equal(percentChange(0,0),null);
});
test('perda de conversão só é mostrada com comparação de relatórios',()=>{
  const noData=diagnosisFromEvidence({ready:false}, {evidence:[]});
  assert.match(noData.label,/Causa não determinada/);
  const proof=diagnosisFromEvidence({}, {evidence:[{key:'conversion',type:'drop',text:'De 10% para 3%'}]});
  assert.match(proof.label,/Conversão/);
  assert.match(proof.why,/De 10%/);
});
test('séries diárias exibem somente observações e não inventam visitas',()=>{
  assert.match(daily,/commerce_current_sales_listing_daily_v1/);
  assert.match(daily,/commerce_listing_traffic_reports_v1/);
  assert.match(daily,/r\.period_start=r\.period_end/);
  assert.match(daily,/left join known_sales/);
  assert.match(daily,/left join known_visits/);
  assert.doesNotMatch(daily,/coalesce\(s\.units,0\)/);
  assert.match(daily,/security invoker set search_path=public/);
  assert.match(daily,/from public,anon,authenticated/);
  assert.match(daily,/to service_role/);
  assert.match(router,/listings\\\/manager\\\/\(\[0-9\]\+\)\\\/daily/);
  assert.match(store,/commerce_listing_diagnosis_daily_v1/);
});
test('tela é responsiva sem fotos, ações falsas ou histórico estimado de variações',()=>{
  assert.match(css,/@media\(max-width:720px\)/);
  assert.match(css,/\.nad-main\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(view,/Período anterior<\/th>/);
  assert.match(view,/não atribuímos queda por SKU sem essa evidência/);
  assert.match(view,/rel="noopener noreferrer"/);
  assert.doesNotMatch(view,/<img|foto.jpg|imageUrl/);
});
