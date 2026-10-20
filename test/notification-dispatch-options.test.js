import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DISPATCH_PLATFORMS,optionsForPlatform,validDispatchOption} from '../src/notification-dispatch-options.js';
import {handleNotificationDispatchRequest} from '../src/notification-dispatch-router.js';

test('ten dispatch platforms remain separate and each has relevant operation choices',()=>{
  assert.equal(DISPATCH_PLATFORMS.length,10);
  for(const platform of DISPATCH_PLATFORMS){
    const options=optionsForPlatform(platform).flatMap(group=>group.options);
    for(const label of ['Full','Empresa','Venda Direta','Flex Avulso','Turbo']){
      assert.ok(options.includes(label),platform+' missing '+label);
    }
  }
  for(const [platform,choice] of [
    ['SHOPEE','Shopee Flex'],
    ['SHOPEE','Full Shopee'],
    ['MERCADO LIVRE ANTIGO','Full Mercado Livre Antigo'],
    ['MERCADO LIVRE NOVO','Full Mercado Livre Novo'],
    ['MERCADO LIVRE','Mercado Flex'],
    ['AMAZON','Amazon Same Day'],
    ['AMAZON','Full Amazon'],
    ['MAGALU','Magalu Vapt'],
    ['LOJA INTEGRADA','Loja Integrada Flex'],
    ['SHEIN','Venda Direta'],
    ['TIK TOK','Empresa'],
    ['KWAI','Full']
  ])assert.equal(validDispatchOption(platform,choice),true);
  assert.equal(validDispatchOption('SHOPEE','Mercado Flex'),false);
  assert.equal(validDispatchOption('MERCADO LIVRE NOVO','Full Mercado Livre Antigo'),false);
  assert.equal(validDispatchOption('AMAZON','Full Shopee'),false);
  assert.equal(validDispatchOption('KWAI','Texto arbitrário'),false);
});
test('server rejects mismatched platform and option without database access',async()=>{
  const r=await handleNotificationDispatchRequest(new Request('https://example.test/api/admin/dispatch/batch',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({calls:[{
      platform:'MERCADO LIVRE NOVO',
      message:'Full Mercado Livre Antigo',
      request_key:crypto.randomUUID()
    }]})
  }),{});
  assert.equal(r.status,400);
});
test('SQL migration expands queue to ten while keeping existing FIFO',()=>{
  const sql=fs.readFileSync(new URL('../supabase/migrations/20261021220000_nisti_dispatch_platforms_modes_v3.sql',import.meta.url),'utf8');
  assert.match(sql,/BETWEEN 1 AND 10/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/dispatch_idempotency_conflict/);
  assert.match(sql,/nisti_dispatch_calls_platform_check/);
});
