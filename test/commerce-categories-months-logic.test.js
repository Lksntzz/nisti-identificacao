import test from 'node:test';
import assert from 'node:assert/strict';
import {gainLoss,notRepeated,yearShare,MONTH_VIEWS} from '../src/commerce-categories-months-logic.js';

const L=[{month:1,cur:10,base:50},{month:2,cur:60,base:20},{month:3,cur:30,base:30},{month:4,cur:0,base:40},{month:5,cur:40,base:35}];
test('gainLoss ordena pela maior diferença absoluta e ignora meses iguais',()=>{
  const r=gainLoss(L);
  assert.deepEqual(r.map(m=>m.month),[1,2,4,5]);
  assert.equal(r[0].diff,-40);
  assert.equal(r[1].diff,40);
});
test('notRepeated traz meses fortes do ano anterior que caíram mais da metade',()=>{
  const r=notRepeated(L);
  assert.deepEqual(r.map(m=>m.month),[1,4]);
  assert.equal(r[0].lost,40);
  assert.deepEqual(notRepeated([{month:1,cur:0,base:0}]),[]);
});
test('yearShare calcula o peso de cada mês no acumulado',()=>{
  const r=yearShare([{month:1,cur:20,base:0},{month:2,cur:80,base:50}]);
  assert.equal(r[0].month,2);
  assert.equal(Math.round(r[0].shareCur),80);
  assert.equal(Math.round(r[1].shareCur),20);
  assert.equal(r[0].shareBase,100);
});
test('yearShare não quebra sem vendas e views existem',()=>{
  assert.deepEqual(yearShare([]),[]);
  assert.equal(MONTH_VIEWS.length,3);
});
