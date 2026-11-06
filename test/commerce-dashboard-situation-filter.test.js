import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Painel Comercial (explorer): filtros em ordem Plataforma, Situação, Período e as 3 abas viram o filtro Situação', () => {
  const ui = fs.readFileSync('src/ga/commerce-dashboard.jsx', 'utf8');
  const a = ui.indexOf("mode==='explorer'&&<Dropdown label=\"Plataforma\"");
  const b = ui.indexOf("<Dropdown label=\"Situação\"");
  const c = ui.indexOf('<PeriodPicker');
  assert.ok(a > 0 && b > a && c > b, 'ordem Plataforma → Situação → Período');
  assert.match(ui, /\['drops','Em queda'\+countOf\('drops'\)/);
  assert.match(ui, /\['stopped','Pararam'\+countOf\('stopped'\)/);
  assert.match(ui, /\['nosales','Sem vendas'\+countOf\('nosales'\)/);
  assert.match(ui, /TAB_BAR=TABS\.filter\(t=>!SITUATION_TABS\.includes\(t\[0\]\)\)/);
  assert.match(ui, /\{TAB_BAR\.map\(/);
});

test('Painel Comercial: aba Sem vendas mostra quem completou N dias (e "Ver todos")', () => {
  const src=fs.readFileSync('src/ga/commerce-dashboard.jsx','utf8');
  assert.match(src,/const inBand=r=>/);
  assert.match(src,/d>=doneDays&&d<=doneDays\+6/);
  assert.match(src,/nsBand\(\)\?inBand\(r\)/);
  assert.match(src,/Ver todos os sem vendas/);
  assert.doesNotMatch(src,/'Completaram '\+doneDays/);
});

test('filtro inteligente: Pararam/Em queda em todo o histórico muda sozinho para 90 dias', () => {
  const src=fs.readFileSync('src/ga/commerce-dashboard.jsx','utf8');
  assert.match(src,/\(tab==='stopped'\|\|tab==='drops'\)&&days===0&&!month\)setDays\(90\)/);
});
