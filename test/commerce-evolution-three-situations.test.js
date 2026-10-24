import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const parent=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const sql=fs.readFileSync('supabase/migrations/20261021220000_commerce_evolution_ads_v1.sql','utf8');

test('filtros do anúncio são separados dos indicadores de evolução',()=>{
 assert.match(parent,/status=\{evolutionStatus\} onStatusChange=\{setEvolutionStatus\}/);
 assert.match(parent,/setStatus\('ALL'\)/);
 assert.match(sql,/p_status text default 'ALL'/);
 assert.match(sql,/and \(i\.status='ALL' or a\.situation=i\.status\)/);
});
