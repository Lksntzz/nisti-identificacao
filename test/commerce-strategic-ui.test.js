// GA-013 — contrato da tela: só as três contas, sem termos financeiros, isolamento por chave, Dashboard intacto.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const ui=read('src/ga/commerce-strategic-view.jsx'),app=read('src/ga/commerce-admin-app-v2.jsx');
const DASH_FILES=['src/ga/commerce-dashboard.jsx','src/ga/commerce-dashboard.css'];

test('tela: nenhum termo de faturamento, lucro, margem ou ticket',()=>{
  assert.doesNotMatch(ui.replace(/^\/\/.*$/gm,''),/faturamento|lucro|margem|ticket|R\$/i);
});
test('tela: usa só as três contas, a chave de escopo (GA-012) e confere conta E dias da resposta',()=>{
  assert.ok(ui.includes('STRATEGIC_PLATFORMS')&&!ui.includes("'TODAS'"));
  assert.ok(ui.includes('isCurrentScope(entry,key)')&&ui.includes('matchesPlatform(current,platform)')&&ui.includes('Number(current.days)===days'));
  assert.ok(ui.includes('/api/admin/commerce/strategic-view?platform='));
});
test('tela: indisponível não é lista vazia, limites e candidatos aparecem',()=>{
  assert.ok(ui.includes('Consulta indisponível no momento')&&ui.includes('Nenhum anúncio nesta lista.'));
  assert.ok(ui.includes('g.limit_note')&&ui.includes('g.ordering_note')&&ui.includes('Candidatos pelos dados importados'));
});
test('menu: Visão estratégica fica depois do Dashboard',()=>{
  assert.ok(app.indexOf("id: 'strategic'")>app.indexOf("id: 'dashboard'")&&app.includes("activeView === 'strategic' && <CommerceStrategicView />"));
});

// Preservação do Dashboard: (a) nunca importa nem é importado pela visão nova (sempre roda); (b) os arquivos não mudam em relação à main.
test('Dashboard: não depende da Visão estratégica (verificação estática, sem git)',()=>{
  for(const f of DASH_FILES)assert.ok(existsSync(new URL('../'+f,import.meta.url)),f+' deve existir');
  const dash=read('src/ga/commerce-dashboard.jsx');
  assert.doesNotMatch(dash,/commerce-strategic/);
  assert.doesNotMatch(ui,/commerce-dashboard/);
});

function resolveBase(){
  const git=(...a)=>execFileSync('git',a,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const has=ref=>{try{git('rev-parse','--verify','--quiet',ref+'^{commit}');return true;}catch{return false;}};
  for(const r of ['origin/main','refs/remotes/origin/main'])if(has(r))return r;
  // Checkout raso do GitHub (sem origin/main): busca só a ponta da main (repositório público, leitura anônima).
  try{
    git('fetch','--no-tags','--depth=1','origin','+refs/heads/main:refs/remotes/origin/main');
    if(has('refs/remotes/origin/main'))return 'refs/remotes/origin/main';
  }catch{/* sem rede */}
  return null;
}
test('Dashboard: arquivos idênticos aos da main (comparação direta de árvores, não precisa de histórico)',t=>{
  let inside=false;
  try{inside=execFileSync('git',['rev-parse','--is-inside-work-tree'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()==='true';}catch{/* sem git */}
  const base=inside?resolveBase():null;
  if(!base){
    // No CI a verificação é obrigatória: se não achou a main, falha em vez de passar em silêncio.
    assert.ok(!process.env.CI,'CI sem origin/main: não foi possível verificar a preservação do Dashboard.');
    t.skip('origin/main indisponível fora do CI: verificação por comparação com a main ignorada (a estática acima continua valendo)');
    return;
  }
  const diff=execFileSync('git',['diff','--name-only',base,'--',...DASH_FILES],{encoding:'utf8'}).trim();
  assert.equal(diff,'','Dashboard alterado em relação à main: '+diff);
});
