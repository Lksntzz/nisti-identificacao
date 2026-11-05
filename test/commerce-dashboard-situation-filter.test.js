import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Painel Comercial (explorer): filtros em ordem Plataforma, Situação, Período e as 3 abas viram o filtro Situação', () => {
  const ui = fs.readFileSync('src/commerce-dashboard.jsx', 'utf8');
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

test('Painel Comercial: filtro "Completaram N dias" na aba Sem vendas', () => {
  const src=fs.readFileSync('src/commerce-dashboard.jsx','utf8');
  assert.match(src,/'Completaram '\+doneDays\+' dias'/);
  assert.match(src,/nsSince\(r\)<=doneDays\+6/);
  assert.match(src,/\.filter\(nsMatch\)/);
});
