// GA-015 — contrato da tela Evolução ABC: três contas, sem termos financeiros, só leitura, preservação das telas existentes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const ui=read('src/ga/commerce-abc-evolution.jsx'),app=read('src/ga/commerce-admin-app-v2.jsx'),router=read('src/ga/commerce-admin-router.js'),store=read('src/ga/commerce-abc-store.js'),logic=read('src/ga/commerce-abc-logic.js');
const code=s=>s.replace(/^\s*\/\/.*$/gm,'');
const PRESERVED=['src/ga/commerce-dashboard.jsx','src/ga/commerce-dashboard.css','src/ga/commerce-strategic-view.jsx','src/ga/commerce-strategic-view.css','src/ga/commerce-strategic-logic.js',
  'src/ga/commerce-decision-center.jsx','src/ga/commerce-decision-center.css','src/ga/commerce-decision-logic.js'];

test('tela, rota, regras e leitura: nenhum termo financeiro',()=>{
  for(const [n,s] of [['tela',ui],['loja',store],['regras',logic]])assert.doesNotMatch(code(s),/faturamento|lucro|margem|ticket|R\$|receita|revenue/i,n);
});
test('tela: só as três contas, escopo por chave e confere conta, comparação e mês da resposta',()=>{
  assert.ok(!ui.includes("'TODAS'"));
  assert.ok(ui.includes('isCurrentScope')&&ui.includes('matchesPlatform')&&ui.includes('cur.mode===mode')&&ui.includes('monthOk'));
  assert.ok(ui.includes('/api/admin/commerce/abc-evolution?'));
});
test('tela: somente leitura e estados bloqueados não viram lista vazia nem classe C',()=>{
  // único POST permitido: o histórico (leitura; SKUs no corpo). Nada de PUT/PATCH/DELETE.
  assert.doesNotMatch(code(ui),/method:\s*['"](PUT|PATCH|DELETE)/i);
  assert.equal((code(ui).match(/method:\s*['"]POST/g)||[]).length,1);
  assert.ok(code(ui).includes("abc-evolution/history?'+q,{signal:c.signal,method:'POST',body:JSON.stringify({skus})"));
  assert.doesNotMatch(code(ui),/[?&]skus=/,'SKUs nunca vão na URL');
  assert.doesNotMatch(code(ui),/>\s*(Alterar|Pausar|Reativar|Aplicar|Salvar)\b/);
  assert.ok(ui.includes('Isto não significa que não houve vendas')&&ui.includes('nunca vira classe C nem "zero vendas"'));
  assert.ok(ui.includes('Concentração alta não prova redução do catálogo ativo'));
});
test('rota: GET único da Evolução ABC, validada, sem corpo',()=>{
  const i=router.indexOf("method==='GET'&&pathname===BASE_PATH+'/abc-evolution'");assert.ok(i>0);
  const block=router.slice(i,router.indexOf('GA-P01 — histórico mensal',i));
  assert.match(block,/method==='GET'|GET/);assert.doesNotMatch(block,/POST|request\.json/);assert.match(block,/Filtro da Evolução ABC inválido/);
  assert.equal(router.split("'/abc-evolution'").length-1,1);
});
test('GA-P01 rota do histórico: POST só de leitura, corpo limitado, sem gravação e sem invalidar o cache de leitura',()=>{
  const i=router.indexOf("method==='POST'&&pathname===BASE_PATH+'/abc-evolution/history'");assert.ok(i>0);
  const block=router.slice(i,i+900);
  assert.match(block,/MAX_BODY_CHARS/);assert.match(block,/parseAbcHistoryRequest/);assert.match(block,/commerceAbcHistoryV1/);
  assert.doesNotMatch(block,/supabaseRpc|insert|update\(|delete/i);
  assert.equal(router.split("/abc-evolution/history'").length-1,1);
  const edge=read('src/edge-router.js');
  assert.match(edge,/abc-evolution\\\/history\$\/\.test\(new URL\(request\.url\)\.pathname\)\) await bumpReadCacheGeneration/);
  assert.doesNotMatch(read('src/ga/commerce-read-cache.js').replace(/\/\/.*$/gm,''),/abc-evolution/,'nenhuma rota da Evolução ABC entra no cache de borda');
});
test('menu: Evolução ABC fica depois da Central de decisões e o Dashboard não a importa',()=>{
  assert.ok(app.indexOf("id: 'abcEvolution'")>app.indexOf("id: 'decisions'")&&app.includes("activeView === 'abcEvolution' && <CommerceAbcEvolution />"));
  for(const f of PRESERVED){assert.ok(existsSync(new URL('../'+f,import.meta.url)),f);assert.doesNotMatch(read(f),/commerce-abc-(evolution|logic|store)/);}
  assert.doesNotMatch(ui,/commerce-dashboard|commerce-decision|commerce-strategic/);
});
test('a Curva ABC atual do Dashboard não é tocada: nenhuma migração existente nem função de ABC antiga foi alterada',()=>{
  const names=execFileSync('git',['ls-tree','-r','--name-only','HEAD','--','supabase/migrations'],{encoding:'utf8'}).split('\n').filter(Boolean);
  assert.ok(names.some(n=>n.endsWith('commerce_abc_units_monthly_v1.sql')));
  assert.doesNotMatch(read('supabase/migrations/20261125160000_commerce_abc_units_monthly_v1.sql').replace(/--.*$/gm,''),/commerce_dashboard_abc|commerce_sales_abc|create or replace function public\.commerce_(dashboard|sales)/i);
});
function baseRef(){
  const git=(...a)=>execFileSync('git',a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const has=r=>{try{git('rev-parse','--verify','--quiet',r+'^{commit}');return true;}catch{return false;}};
  for(const r of ['origin/main','refs/remotes/origin/main'])if(has(r))return r;
  try{git('fetch','--no-tags','--depth=1','origin','+refs/heads/main:refs/remotes/origin/main');if(has('refs/remotes/origin/main'))return 'refs/remotes/origin/main';}catch{/* sem rede */}
  return null;
}
test('preservação: Dashboard, Visão estratégica e Central de decisões idênticos à main',t=>{
  let inside=false;
  try{inside=execFileSync('git',['rev-parse','--is-inside-work-tree'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()==='true';}catch{/* sem git */}
  const base=inside?baseRef():null;
  if(!base){assert.ok(!process.env.CI,'CI sem origin/main.');t.skip('origin/main indisponível fora do CI');return;}
  const diff=execFileSync('git',['diff','--name-only',base,'--',...PRESERVED],{encoding:'utf8'}).trim();
  assert.equal(diff,'','Arquivos preservados alterados: '+diff);
});

// ---- revisão final: vocabulário de identidade ----
import { readFileSync as readUi } from 'node:fs';
test('a tela diz "entrou/saiu da curva" e nunca afirma produto novo ou perdido; semelhança é só alerta',()=>{
  const src=readUi(new URL('../src/ga/commerce-abc-evolution.jsx',import.meta.url),'utf8');
  assert.match(src,/Entrou na curva/); assert.match(src,/Saiu da curva/); assert.match(src,/sua ausência não comprova que a identidade do SKU permaneceu estável/);
  assert.ok(!/produto novo|produto perdido|Não afirma produto|Sem venda antes|Sem venda agora/.test(src),'sem afirmar produto novo/perdido');
  assert.match(src,/duração diferente/);
});

// ---- GA-P01: histórico sob demanda ----
test('GA-P01 tela: indicadores não pedem histórico; histórico só por clique, com estado próprio e rota própria',()=>{
  const c=code(ui);
  assert.ok(c.includes('/api/admin/commerce/abc-evolution/history?'));assert.ok(c.includes('unavailable-retry')&&c.includes('VERSAO_INDISPONIVEL'),'versão indisponível: mensagem e nova tentativa');
  assert.ok(c.includes('history-load')&&c.includes('history-loading')&&c.includes('history-error')&&c.includes('history-retry'));
  // a chamada do histórico só existe dentro de loadHistory (nunca no efeito que carrega os indicadores)
  const eff=c.slice(c.indexOf('useEffect(()=>{'),c.indexOf('},[key,tick]);'));
  assert.ok(!eff.includes('/history'),'efeito dos indicadores não pode pedir histórico');
  assert.ok(c.includes('histBusy.current===histKey'),'sem requisição duplicada');
});
test('GA-P01 tela: descarta resposta de outra conta, comparação, mês, dia ou versão; versão alterada nunca mistura',()=>{
  const c=code(ui);
  for(const t of ['d.platform===platform','d.mode===mode','d.last_complete_day===okData.last_complete_day','d.data_version===okData.data_version','VERSAO_ALTERADA','VERSAO_INDISPONIVEL','signal.aborted'])assert.ok(c.includes(t),t);
  assert.ok(c.includes('histCtl.current?.abort()'),'cancela o histórico do filtro anterior');
  assert.ok(c.includes('versionRetry.current.n<2'),'repetição limitada');
});
test('GA-P01 tela: seletor de mês vem dos indicadores (history_months) e o histórico é só leitura',()=>{
  const c=code(ui);
  assert.ok(c.includes('history_months'));
  assert.doesNotMatch(c,/method:\s*['"](PUT|PATCH|DELETE)/i);
  assert.doesNotMatch(c,/faturamento|lucro|margem|ticket|R\$|receita|revenue/i);
});
