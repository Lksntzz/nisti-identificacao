import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const child=fs.readFileSync('src/commerce-evolution-integrated.jsx','utf8');
const parent=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const sql=fs.readFileSync('supabase/migrations/20261021220000_commerce_evolution_ads_v1.sql','utf8');

test('Situação das vendas oferece somente Sem vendas, Estável e Crescimento',()=>{
 const text=child.match(/const STATUS=([^\n]+);/);
 assert.ok(text);
 assert.equal((text[1].match(/\['/g)||[]).length,3);
 assert.deepEqual([...text[1].matchAll(/\['([A-Z]+)','([^']+)'\]/g)].map(x=>[x[1],x[2]]),
   [['ZERO','Sem vendas'],['STABLE','Estável'],['RISING','Crescimento']]);
 assert.doesNotMatch(text[1],/FALLING|SOLD|NEW|INSUFFICIENT/);
 assert.match(child,/STATUS\.map\(\(\[value,label\]\)=><option key=\{value\} value=\{value\}>/);
});

test('visão geral recuperável pelo cartão Total, sem quarta situação selecionável',()=>{
 assert.match(child,/onClick=\{\(\)=>onStatusChange\(card\.id\)\}/);
 assert.match(child,/id:'ALL',label:'Total de anúncios'/);
 assert.match(child,/onStatusChange\('ALL'\)/);
 assert.match(child,/<option value="ALL" disabled hidden>/);
});

test('filtros do anúncio são separados dos indicadores de evolução',()=>{
 assert.match(parent,/status=\{evolutionStatus\} onStatusChange=\{setEvolutionStatus\}/);
 assert.match(parent,/setStatus\('ALL'\)/);
 assert.match(sql,/p_status text default 'ALL'/);
 assert.match(sql,/and \(i\.status='ALL' or a\.situation=i\.status\)/);
});
