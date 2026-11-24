import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Painel Comercial (explorer): filtros em ordem Plataforma, Situação, Período e as 3 abas viram o filtro Situação', () => {
  const ui = fs.readFileSync('src/ga/commerce-dashboard.jsx', 'utf8');
  // GA-012: a plataforma agora é o seletor segmentado (fora do Dropdown), acima da Situação e do Período.
  const a = ui.indexOf('<PlatformSelector');
  const b = ui.indexOf("<Dropdown label=\"Situação\"");
  const c = ui.indexOf('<PeriodPicker');
  assert.ok(b > 0 && c > b, 'ordem Situação → Período');
  assert.ok(a > c, 'seletor de plataforma renderizado logo abaixo do cabeçalho, fora da lista de filtros');
  assert.doesNotMatch(ui, /<Dropdown label="Plataforma"/);
  assert.match(ui, /\['drops','Em queda'\+countOf\('drops'\)/);
  // Pararam foi juntada em Sem vendas (filtro "Vendia e parou"): não existe mais como aba própria.
  assert.doesNotMatch(ui, /\['stopped','Pararam'/);
  assert.match(ui, /\['stopped','Vendia e parou',stoppedCount\]/);
  assert.match(ui, /\['nosales','Sem vendas'\+countOf\('nosales'\)/);
  assert.match(ui, /TAB_BAR=TABS\.filter\(t=>!SITUATION_TABS\.includes\(t\[0\]\)\)/);
  assert.match(ui, /\{TAB_BAR\.map\(/);
});

test('Painel Comercial: aba Sem vendas mostra quem completou N dias (e "Ver todos")', () => {
  const src=fs.readFileSync('src/ga/commerce-dashboard.jsx','utf8');
  assert.match(src,/const inBand=r=>/);
  assert.match(src,/d>=doneDays&&d<=Math\.min\(doneDays\+6,90\)/);
  assert.match(src,/nsBand\(\)\?inBand\(r\)/);
  assert.match(src,/Ver todos os sem vendas/);
  assert.doesNotMatch(src,/'Completaram '\+doneDays/);
});

test('filtro inteligente: Pararam/Em queda em todo o histórico muda sozinho para 90 dias', () => {
  const src=fs.readFileSync('src/ga/commerce-dashboard.jsx','utf8');
  assert.match(src,/\(\(tab==='nosales'&&nsf==='stopped'\)\|\|tab==='drops'\)&&days===0&&!month\)setDays\(90\)/);
});
