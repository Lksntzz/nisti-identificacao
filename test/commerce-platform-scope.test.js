import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCOPE_PLATFORMS,scopeKey,makeEntry,isCurrentScope,matchesPlatform,filterAttentionPlatforms,
  perfStatus,salesNotice,qualityPeriod,qualityStrip
} from '../src/ga/commerce-platform-scope-logic.js';

test('GA-012: quatro opções na ordem pedida, Consolidado primeiro, cores distintas',()=>{
  assert.deepEqual(SCOPE_PLATFORMS.map(p=>p.id),['TODAS','SHOPEE','ML_ANTIGO','ML_NOVO']);
  assert.deepEqual(SCOPE_PLATFORMS.map(p=>p.label),['Consolidado','Shopee','ML Antigo','ML Novo']);
  assert.equal(new Set(SCOPE_PLATFORMS.map(p=>p.color)).size,4);
});

test('GA-012: chave de escopo muda com plataforma, período e mês',()=>{
  const a=scopeKey({platform:'SHOPEE',days:30,month:''});
  assert.notEqual(a,scopeKey({platform:'ML_NOVO',days:30,month:''}));
  assert.notEqual(a,scopeKey({platform:'SHOPEE',days:7,month:''}));
  assert.notEqual(a,scopeKey({platform:'SHOPEE',days:30,month:'2026-10'}));
  assert.equal(a,scopeKey({platform:'SHOPEE',days:30}));
});

test('GA-012: resposta antiga é rejeitada; só a do escopo atual passa',()=>{
  const kA=scopeKey({platform:'SHOPEE',days:30,month:''}),kB=scopeKey({platform:'ML_NOVO',days:30,month:''});
  const eA=makeEntry(kA,{platform:'SHOPEE'});
  assert.equal(isCurrentScope(eA,kA),true);
  assert.equal(isCurrentScope(eA,kB),false);
  assert.equal(isCurrentScope(null,kA),false);
  assert.equal(isCurrentScope(undefined,kA),false);
});

test('GA-012: resposta cujo "platform" difere do pedido é rejeitada; sem o campo, aceita',()=>{
  assert.equal(matchesPlatform({platform:'SHOPEE'},'SHOPEE'),true);
  assert.equal(matchesPlatform({platform:'ML_NOVO'},'SHOPEE'),false);
  assert.equal(matchesPlatform({totals:{}},'SHOPEE'),true);
  assert.equal(matchesPlatform(null,'SHOPEE'),false);
});

test('GA-012: painel Atenção mostra só a plataforma escolhida; Consolidado mostra as três',()=>{
  const plats=[{platform:'SHOPEE'},{platform:'ML_ANTIGO'},{platform:'ML_NOVO'}];
  assert.equal(filterAttentionPlatforms(plats,'TODAS').length,3);
  assert.deepEqual(filterAttentionPlatforms(plats,'ML_NOVO').map(p=>p.platform),['ML_NOVO']);
  assert.deepEqual(filterAttentionPlatforms(plats,'SHOPEE').map(p=>p.platform),['SHOPEE']);
  assert.deepEqual(filterAttentionPlatforms(null,'SHOPEE'),null);
  assert.deepEqual(filterAttentionPlatforms([{platform:'SHOPEE'}],'ML_ANTIGO'),[]);
});

const ml={reports:[{account:'NOVO',start:'2026-10-01',end:'2026-10-27'}],items:{MLB1:{visits:10}}};
const sp={reports:[{start:'2026-11-01',end:'2026-11-22'}],items:{111:{visits:5}}};

test('GA-012: relatórios de desempenho por conta — ML Antigo sem relatório não herda o de outra conta',()=>{
  assert.equal(perfStatus('ML_ANTIGO',{ml,shopee:sp}).has,false);
  assert.equal(perfStatus('ML_NOVO',{ml,shopee:sp}).has,true);
  assert.equal(perfStatus('SHOPEE',{ml,shopee:sp}).has,true);
  assert.equal(perfStatus('TODAS',{ml,shopee:sp}).has,true);
  assert.equal(perfStatus('TODAS',{ml:null,shopee:null}).has,false);
});

test('GA-012: notas de relatório listam só a conta escolhida',()=>{
  const n=p=>perfStatus(p,{ml,shopee:sp}).notes.join(' | ');
  assert.match(n('ML_NOVO'),/ML Novo 01\/10 a 27\/10/);
  assert.doesNotMatch(n('ML_NOVO'),/Shopee/);
  assert.match(n('SHOPEE'),/Shopee 01\/11 a 22\/11/);
  assert.doesNotMatch(n('SHOPEE'),/ML/);
  assert.equal(perfStatus('ML_ANTIGO',{ml,shopee:sp}).notes.length,0);
  assert.match(n('TODAS'),/ML Novo/);assert.match(n('TODAS'),/Shopee/);
});

test('GA-012: ausência de informação é diferente de zero vendas',()=>{
  const none=salesNotice({platform:'ML_NOVO',coverage:null,data:{last_day:null,totals:{}}});
  assert.equal(none.kind,'SEM_INFORMACAO');
  assert.match(none.text,/ML Novo/);assert.match(none.text,/Sem informação/i);
  const zero=salesNotice({platform:'ML_NOVO',coverage:{last_day:'2026-11-20'},data:{last_day:'2026-11-20',totals:{cur_units:0,cur_rev:0}}});
  assert.equal(zero.kind,'ZERO');
  assert.match(zero.text,/20\/11\/2026/);
  assert.doesNotMatch(zero.text,/Sem informação/i);
  assert.equal(salesNotice({platform:'SHOPEE',coverage:{last_day:'2026-11-20'},data:{last_day:'2026-11-20',totals:{cur_units:5,cur_rev:100}}}),null);
  assert.equal(salesNotice({platform:'SHOPEE',coverage:null,data:null}),null);
});

test('GA-012: período da faixa de qualidade segue dias, mês ou ano e respeita o teto',()=>{
  const today=new Date(2026,10,24);
  assert.deepEqual(qualityPeriod(30,'',today),{start:'2026-10-26',end:'2026-11-24'});
  assert.deepEqual(qualityPeriod(7,'',today),{start:'2026-11-18',end:'2026-11-24'});
  assert.deepEqual(qualityPeriod(30,'2026-10',today),{start:'2026-10-01',end:'2026-10-31'});
  assert.deepEqual(qualityPeriod(30,'2026-11',today),{start:'2026-11-01',end:'2026-11-24'});
  assert.deepEqual(qualityPeriod(30,'2026',today),{start:'2026-01-01',end:'2026-11-24'});
  assert.deepEqual(qualityPeriod(0,'',today),{start:'2026-08-27',end:'2026-11-24'});
});

const dq=(over={})=>({platform:'ML_NOVO',period:{start:'2026-10-26',end:'2026-11-24',today:'2026-11-24'},
  sales:{status:'PARCIAL',freshness:'ATUALIZADO',last_sale_day:'2026-11-24',reconciliation:{status:'CONCILIADO_INTERNAMENTE',months_checked:2,months_ok:2,divergent_months:[]}},ga011_shopee:null,...over});

test('GA-012: faixa compacta da GA-018 traz última venda, atualização e conciliação interna',()=>{
  const s=qualityStrip(dq());
  assert.equal(s.last,'24/11/2026');
  assert.equal(s.fresh,'Atualizado');
  assert.equal(s.recon,'Conciliado internamente');
  assert.equal(s.reconTone,'ok');
});

test('GA-012: faixa nunca mostra conciliação aprovada se uma aplicável está sem informação (Shopee)',()=>{
  const s=qualityStrip(dq({platform:'SHOPEE',ga011_shopee:{reconciliation_status:'SEM_INFORMACAO'}}));
  assert.notEqual(s.recon,'Conciliado internamente');
  assert.match(s.recon,/parcial/i);
});

test('GA-012: faixa sem dados devolve null (nada a mostrar, nada inventado)',()=>{
  assert.equal(qualityStrip(null),null);
  assert.equal(qualityStrip({}),null);
});
