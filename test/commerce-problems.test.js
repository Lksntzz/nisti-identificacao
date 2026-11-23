import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.existsSync(p)?fs.readFileSync(p,'utf8'):'';
const code=s=>s.split('\n').filter(l=>!/^\s*--/.test(l)).join('\n');

const GROUPS_SQL='supabase/migrations/20261123180000_commerce_problem_groups_v1.sql';
const groups=read(GROUPS_SQL),groupsCode=code(groups);

function assertReadOnlySecure(sql,fn){
  const c=code(sql);
  assert.ok(c.length>0,'migração existe');
  assert.match(c,new RegExp('create or replace function public\\.'+fn+'\\('));
  assert.match(c,/security invoker/);
  assert.match(c,/set search_path=public/);
  assert.match(c,/revoke all on function public\.[a-z_0-9]+\(integer\) from public,\s*anon,\s*authenticated/);
  assert.match(c,/grant execute on function public\.[a-z_0-9]+\(integer\) to service_role/);
  assert.doesNotMatch(c,/\b(insert\s+into|update\s+public|delete\s+from|drop\s+table|truncate)\b/i,'somente leitura');
}

test('grupos: função segura, somente leitura e só com janelas 30/60/90',()=>{
  assertReadOnlySecure(groups,'commerce_problem_groups_v1');
  assert.match(groupsCode,/p_days is null or p_days not in \(30,\s*60,\s*90\)/);
});
test('grupos: só anúncios ativos, plataforma pelo account_code e sem usar created_at do GA como idade',()=>{
  assert.match(groupsCode,/listing_status='ACTIVE'/);
  assert.match(groupsCode,/'ML_'\|\|l\.account_code/);
  assert.doesNotMatch(groupsCode,/created_at/);
});
test('grupos: valores do desenho (90 dias, 30%, 10 unidades, 1.000 impressões, 100 visitantes, metade da média)',()=>{
  assert.match(groupsCode,/e-90/);
  assert.match(groupsCode,/u_base>=10/);
  assert.match(groupsCode,/0\.7/);
  assert.match(groupsCode,/l_imp>=1000/);
  assert.match(groupsCode,/l_vis>=100/);
  assert.match(groupsCode,/0\.5\*/);
});
test('grupos: prioridade Parou > Em queda > Pior performance > Nunca vendeu em um só case',()=>{
  const m=/case\s+when\s+is_parou\s+then\s+'PAROU'\s+when\s+is_queda\s+then\s+'QUEDA'\s+when\s+is_pior\s+then\s+'PIOR'\s+when\s+is_nunca\s+then\s+'NUNCA'/.exec(groupsCode);
  assert.ok(m,'case de prioridade');
});

const DIAG_SQL='supabase/migrations/20261123190000_commerce_platform_diagnosis_v1.sql';
const diag=read(DIAG_SQL),diagCode=code(diag);
test('diagnóstico: função segura, somente leitura e só com janelas 30/60/90',()=>{
  assertReadOnlySecure(diag,'commerce_platform_diagnosis_v1');
  assert.match(diagCode,/p_days is null or p_days not in \(30,\s*60,\s*90\)/);
});
test('diagnóstico: régua sem dados nunca vira queda (base_ok) e ano passado só com cobertura (ly_ok)',()=>{
  assert.match(diagCode,/'base_ok'/);assert.match(diagCode,/'ly_ok'/);
  assert.match(diagCode,/case when ok then round\(/);
  assert.match(diagCode,/first_day<=w\.ly_start/);
});
test('diagnóstico: top 5, anúncios inativos marcados e % da perda vinda de inativos',()=>{
  assert.match(diagCode,/rn<=5/);
  assert.match(diagCode,/'active'/);
  assert.match(diagCode,/'inactive_share_pct'/);
  assert.match(diagCode,/'share_pct'/);
});

const store=read('src/ga/commerce-supabase-store.js'),router=read('src/ga/commerce-admin-router.js');
test('store: funções de leitura chamam as duas funções SQL com p_days (padrão 30)',()=>{
  assert.match(store,/export async function commerceProblemGroups\(/);
  assert.match(store,/export async function commerceProblemPlatforms\(/);
  assert.match(store,/'commerce_problem_groups_v1',\{p_days:/);
  assert.match(store,/'commerce_platform_diagnosis_v1',\{p_days:/);
  assert.match(store,/\[30,60,90\]\.includes\(Number\(days\)\)\?Number\(days\):30/);
});
test('router: rotas /problems/groups e /problems/platforms só aceitam 30, 60 ou 90',()=>{
  assert.match(router,/\/problems\/groups/);assert.match(router,/\/problems\/platforms/);
  assert.match(router,/\[30,60,90\]\.includes\(days\)/);
  assert.match(router,/Filtro inválido\. Escolha 30, 60 ou 90 dias\./);
  assert.match(router,/commerceProblemGroups\(env,\{days\}\)/);assert.match(router,/commerceProblemPlatforms\(env,\{days\}\)/);
});

test('grupos: itens trazem impressões, visitantes e conversão da loja para o card de Pior performance',()=>{
  assert.match(groupsCode,/'impressions',l_imp/);
  assert.match(groupsCode,/'visitors',l_vis/);
  assert.match(groupsCode,/'conv_pct'/);
  assert.match(groupsCode,/'store_conv_pct'/);
});

const panel=read('src/ga/commerce-problems.jsx'),app=read('src/ga/commerce-admin-app-v2.jsx');
test('painel: busca grupos e diagnóstico, seletor 30/60/90 com padrão 30 e cards dos 4 grupos',()=>{
  assert.match(panel,/\/api\/admin\/commerce\/problems\/groups\?days=/);
  assert.match(panel,/\/api\/admin\/commerce\/problems\/platforms\?days=/);
  assert.match(panel,/useState\(30\)/);assert.match(panel,/GROUPS\.map\(/);
  assert.match(panel,/\[30,60,90\]/);
});
test('painel: avisos de campanha, relatório velho (30+ dias), Pior performance oculto (90+), sem venda desde jan/2025 e SEM_IDADE à parte',()=>{
  assert.match(panel,/campaignWarning\(/);
  assert.match(panel,/age_days\s*>=\s*30/);assert.match(panel,/age_days\s*>\s*90/);
  assert.match(panel,/sem venda desde jan\/2025/);
  assert.match(panel,/SEM_IDADE/);assert.match(panel,/EM_TESTE/);
});
test('painel: motivo só na Shopee, detalhe recolhido e diagnóstico por anúncio pela rota existente',()=>{
  assert.match(panel,/\/api\/admin\/commerce\/listings\/manager\/performance-diagnosis\?ids=/);
  assert.match(panel,/aria-expanded=\{open\}/);assert.match(panel,/\{open&&/);
  assert.match(panel,/sem relatório de desempenho do ML/);
});
test('menu: abaixo de Categorias, "Anúncios com problema" e painel novo renderizado',()=>{
  assert.match(app,/\{ id: 'categories', label: 'Categorias' \},\s*\{ id: 'why', label: 'Anúncios com problema', view: 'why' \}/);
  assert.match(app,/why: 'Anúncios com problema'/);
  assert.match(app,/activeView === 'why' && <CommerceProblems \/>/);
});
