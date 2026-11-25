// GA-014 — contrato da Central de decisões: três contas, sem termos financeiros, só leitura e preservação das telas existentes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const ui=read('src/ga/commerce-decision-center.jsx'),app=read('src/ga/commerce-admin-app-v2.jsx'),router=read('src/ga/commerce-admin-router.js');
const code=s=>s.replace(/^\s*\/\/.*$/gm,'');
const PRESERVED=['src/ga/commerce-dashboard.jsx','src/ga/commerce-dashboard.css','src/ga/commerce-strategic-view.jsx','src/ga/commerce-strategic-view.css','src/ga/commerce-strategic-logic.js'];

test('tela: nenhum termo financeiro',()=>{
  assert.doesNotMatch(code(ui),/faturamento|lucro|margem|ticket|R\$/i);
});
test('tela: só as três contas, escopo por chave e confere conta e dias da resposta',()=>{
  assert.ok(!ui.includes("'TODAS'"));
  assert.ok(ui.includes('isCurrentScope')&&ui.includes('matchesPlatform')&&ui.includes('Number(current.days)===days'));
  assert.ok(ui.includes('/api/admin/commerce/decision-center?platform='));
});
test('tela: somente leitura (nenhuma chamada que não seja GET e nenhum botão de alteração)',()=>{
  assert.doesNotMatch(code(ui),/method:\s*['"](POST|PUT|PATCH|DELETE)/i);
  assert.doesNotMatch(code(ui),/>\s*(Alterar|Pausar|Reativar|Editar preço|Aplicar)\b/);
});
test('tela: situação é último estado cadastrado e indisponível não vira lista vazia',()=>{
  assert.ok(read('src/ga/commerce-decision-logic.js').includes('Último estado cadastrado'),'a situação é rotulada como último estado cadastrado');
  assert.doesNotMatch(code(ui),/em tempo real|confirmad[oa] agora/i);
  assert.ok(ui.includes('Consulta indisponível:')&&ui.includes('Isto não significa que não existam')&&ui.includes('Nenhum anúncio nesta faixa.'));
});
test('rota: GET único da Central de decisões, protegida como as demais',()=>{
  assert.ok(router.includes("BASE_PATH+'/decision-center'"));
  assert.doesNotMatch(router.slice(router.indexOf("BASE_PATH+'/decision-center'"),router.indexOf("BASE_PATH+'/decision-center'")+400),/POST|request\.json/);
});
test('menu: Central de decisões fica depois da Visão estratégica',()=>{
  assert.ok(app.indexOf("id: 'decisions'")>app.indexOf("id: 'strategic'")&&app.includes("activeView === 'decisions' && <CommerceDecisionCenter />"));
});
test('preservação: telas existentes não importam a Central de decisões',()=>{
  for(const f of PRESERVED){assert.ok(existsSync(new URL('../'+f,import.meta.url)),f+' deve existir');assert.doesNotMatch(read(f),/commerce-decision/);}
  assert.doesNotMatch(ui,/commerce-dashboard/);
});
function baseRef(){
  const git=(...a)=>execFileSync('git',a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const has=r=>{try{git('rev-parse','--verify','--quiet',r+'^{commit}');return true;}catch{return false;}};
  for(const r of ['origin/main','refs/remotes/origin/main'])if(has(r))return r;
  try{git('fetch','--no-tags','--depth=1','origin','+refs/heads/main:refs/remotes/origin/main');if(has('refs/remotes/origin/main'))return 'refs/remotes/origin/main';}catch{/* sem rede */}
  return null;
}
test('preservação: Dashboard, Visão estratégica, GA-018/019/021 idênticos à main',t=>{
  let inside=false;
  try{inside=execFileSync('git',['rev-parse','--is-inside-work-tree'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()==='true';}catch{/* sem git */}
  const base=inside?baseRef():null;
  if(!base){assert.ok(!process.env.CI,'CI sem origin/main.');t.skip('origin/main indisponível fora do CI');return;}
  const files=[...PRESERVED,...execFileSync('git',['ls-tree','-r','--name-only',base,'--','src/ga','test'],{encoding:'utf8'}).split('\n').filter(f=>/data-quality|quality|shopee-sales-link|sales-link-split/.test(f)&&!/decision/.test(f))];
  const diff=execFileSync('git',['diff','--name-only',base,'--',...files],{encoding:'utf8'}).trim();
  assert.equal(diff,'','Arquivos preservados alterados: '+diff);
});
