import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getSharedFilter,setSharedFilter,resetSharedFilter} from '../src/ga/commerce-shared-filter.js';

test('filtro compartilhado: começa em 30 dias / todas as plataformas / sem mês',()=>{
  resetSharedFilter();
  assert.deepEqual(getSharedFilter(),{platform:'TODAS',days:30,month:''});
});
test('filtro compartilhado: guarda o que foi escolhido e devolve em outra tela',()=>{
  resetSharedFilter();
  setSharedFilter({platform:'SHOPEE',days:60});
  assert.deepEqual(getSharedFilter(),{platform:'SHOPEE',days:60,month:''});
  setSharedFilter({month:'2026-10'});
  assert.equal(getSharedFilter().platform,'SHOPEE');assert.equal(getSharedFilter().month,'2026-10');
});
test('filtro compartilhado: ignora valores inválidos e resetSharedFilter volta ao padrão',()=>{
  resetSharedFilter();
  setSharedFilter({platform:'XYZ',days:-5});
  assert.deepEqual(getSharedFilter(),{platform:'TODAS',days:30,month:''});
  setSharedFilter({days:0});assert.equal(getSharedFilter().days,0);
  resetSharedFilter();assert.equal(getSharedFilter().days,30);
});
test('Dashboard e painel Anúncios com problema leem e gravam o filtro compartilhado',()=>{
  const d=fs.readFileSync('src/ga/commerce-dashboard.jsx','utf8');
  const p=fs.readFileSync('src/ga/commerce-problems.jsx','utf8');
  assert.match(d,/getSharedFilter\(\)/);assert.match(d,/setSharedFilter\(\{platform,days,month\}\)/);
  assert.match(p,/getSharedFilter\(\)/);assert.match(p,/setSharedFilter\(/);assert.match(p,/resetSharedFilter\(\)/);
});
