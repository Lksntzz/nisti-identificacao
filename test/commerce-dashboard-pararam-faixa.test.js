import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../src/ga/commerce-dashboard.jsx', import.meta.url), 'utf8');

test('Pararam: teto de 90 dias e faixa N a N+6 com 7/30/60/90', () => {
  assert.match(src, /const STOP_MAX=90;/);
  assert.match(src, /d>STOP_MAX\)return false/);
  assert.match(src, /d>=doneDays&&d<=Math\.min\(doneDays\+6,STOP_MAX\)/);
  assert.match(src, /const stoppedRows=stoppedShown\.filter\(hit\)/);
});

test('Pararam: contagens do card, alerta e aba usam a mesma lista filtrada', () => {
  assert.match(src, /const stoppedCount=stoppedShown\.length/);
  assert.equal((src.match(/stoppedCount/g) || []).length >= 2, true);
  assert.doesNotMatch(src, /ov\.stopped_total\?\?/);
});

test('Pararam virou filtro dentro de Sem vendas e os atalhos antigos continuam funcionando', () => {
  assert.match(src, /initialTab==='never'\|\|initialTab==='stopped'\?'nosales'/);
  assert.match(src, /if\(k==='never'\|\|k==='stopped'\)\{setNsf\(k\);setTab\('nosales'\);\}/);
  assert.match(src, /tab==='nosales'&&nsf==='stopped'&&!all/);
});
