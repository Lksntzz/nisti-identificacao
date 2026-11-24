// GA-013 — contrato da tela: só as três contas, sem termos financeiros, isolamento por chave, Dashboard intacto.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const ui=read('src/ga/commerce-strategic-view.jsx'),app=read('src/ga/commerce-admin-app-v2.jsx');

test('tela: nenhum termo de faturamento, lucro, margem ou ticket',()=>{
  assert.doesNotMatch(ui.replace(/^\/\/.*$/gm,'').replace(/Não mostra faturamento, lucro, margem nem ticket médio\./,''),/faturamento|lucro|margem|ticket|R\$/i);
});
test('tela: usa só as três contas e a chave de escopo (GA-012)',()=>{
  assert.ok(ui.includes('STRATEGIC_PLATFORMS')&&!ui.includes("'TODAS'"));
  assert.ok(ui.includes('isCurrentScope(entry,key)')&&ui.includes('matchesPlatform(entry.data,platform)'));
  assert.ok(ui.includes('/api/admin/commerce/strategic-view?platform='));
});
test('tela: histórico não verificado e período sem cobertura aparecem identificados',()=>{
  assert.ok(ui.includes('não verificado')&&ui.includes('“nunca vendeu” não é afirmado'));
  assert.ok(ui.includes('exige os dois períodos verificados'));
});
test('menu: Visão estratégica fica depois do Dashboard e o Dashboard não foi alterado',()=>{
  assert.ok(app.indexOf("id: 'strategic'")>app.indexOf("id: 'dashboard'")&&app.includes("activeView === 'strategic' && <CommerceStrategicView />"));
  const diff=execFileSync('git',['diff','--name-only','origin/main'],{encoding:'utf8'});
  assert.doesNotMatch(diff,/commerce-dashboard\.jsx|commerce-dashboard\.css/);
});
