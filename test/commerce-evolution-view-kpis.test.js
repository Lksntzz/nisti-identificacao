import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager=fs.readFileSync('src/ga/commerce-ad-manager.jsx','utf8');
const store=fs.readFileSync('src/ga/commerce-supabase-store.js','utf8');
const router=fs.readFileSync('src/ga/commerce-admin-router.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261021220000_commerce_evolution_ads_v1.sql','utf8');

test('the three status cards filter the same listing/variation report',()=>{
 assert.doesNotMatch(manager,/evolutionStatus/);
 assert.doesNotMatch(manager,/trendOverview|trendRequest/);
});
