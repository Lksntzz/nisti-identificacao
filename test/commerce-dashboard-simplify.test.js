import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const dash=fs.readFileSync('src/ga/commerce-dashboard.jsx','utf8');
const charts=fs.readFileSync('src/ga/commerce-dashboard-charts.jsx','utf8');
test('dashboard: cards "Faturamento" e "Vendendo" removidos; total continua no cabeçalho de Faturamento por produto',()=>{
  assert.doesNotMatch(dash,/label="Faturamento"/);
  assert.doesNotMatch(dash,/label="Vendendo"/);
  assert.match(dash,/Total \{money\(totals\.cur_rev\)\}/);
});
test('dashboard: "Vendas por dia" recolhe com botão aria-expanded, aberto por padrão',()=>{
  assert.match(dash,/collapsible/);
  assert.match(dash,/useState\(true\)/);
  assert.match(dash,/aria-expanded=\{open\}/);
});
test('PlatformSplit: pizza em SVG com fatias clicáveis',()=>{
  const s=charts.slice(charts.indexOf('export function PlatformSplit'),charts.indexOf('export function PlatformTable'));
  assert.match(s,/<svg/);assert.match(s,/<path/);assert.match(s,/onPick/);
});

const probs=fs.readFileSync('src/ga/commerce-dashboard-problems.jsx','utf8');
test('Atenção: uma linha por plataforma com headline(), aviso de campanha e "escolha 30, 60 ou 90 dias"',()=>{
  assert.match(probs,/export function AttentionByPlatform/);
  assert.match(probs,/headline\(/);assert.match(probs,/windowWarning\(/);
  assert.match(probs,/escolha 30, 60 ou 90 dias/);
  assert.match(dash,/<AttentionByPlatform /);
  assert.match(dash,/\/api\/admin\/commerce\/problems\/platforms\?days=/);
  assert.match(dash,/\/api\/admin\/commerce\/problems\/groups\?days=/);
});
test('card "Nunca vendeu": candidatos × em teste, rótulo novo',()=>{
  assert.match(dash,/label="Nunca vendeu"/);assert.doesNotMatch(dash,/label="Não vendeu"/);
  assert.match(dash,/candidatos/);assert.match(dash,/em teste/);
});
test('Resumo do período: um bloco por plataforma, sem totais globais',()=>{
  assert.match(probs,/export function PlatformSummary/);
  assert.match(probs,/PLATS\.filter\(/);
  assert.match(dash,/<PlatformSummary /);
  assert.doesNotMatch(dash,/<SummaryList /);
});
test('Atenção/Nunca vendeu: falha da consulta mostra "consulta indisponível" e "escolha 30, 60 ou 90" só sem janela válida',()=>{
  assert.match(dash,/problemsError/);
  assert.match(dash,/consulta indisponível/);
  assert.match(dash,/problemDays\?\(problems\?.*consultando….*\):'escolha 30, 60 ou 90 dias'/);
  assert.match(probs,/error/);
});
test('cards do Dashboard: as duas linhas de 3 cards ocupam a largura toda (3 colunas), 2 e 1 em telas menores',()=>{
  const css=fs.readFileSync('src/ga/commerce-dashboard.css','utf8');
  assert.match(css,/\.ndb-sum-row,\s*\.ndb-idx-row\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);
  assert.match(css,/@media \(max-width:1180px\)\{\.ndb-sum-row,\.ndb-idx-row\{grid-template-columns:repeat\(2,/);
  assert.match(css,/@media \(max-width:700px\)\{\.ndb-sum-row,\.ndb-idx-row\{grid-template-columns:1fr\}\}/);
});
