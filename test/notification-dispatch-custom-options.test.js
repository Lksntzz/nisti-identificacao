import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DISPATCH_PLATFORMS,dispatchOptionGroups,dispatchOptionValid,formatDispatchText} from '../src/notification-dispatch-options.js';
import {handleNotificationDispatchRequest} from '../src/notification-dispatch-router.js';

test('RETIRAR CAPA is universal and cannot disappear',()=>{
 for(const platform of DISPATCH_PLATFORMS){
  assert.equal(formatDispatchText(platform,'RETIRAR CAPA'),'RETIRAR CAPA');
  assert.equal(dispatchOptionValid(platform,'RETIRAR CAPA',{}),true);
 }
 assert.deepEqual(dispatchOptionGroups('SHEIN',{'SHEIN':[]})[0].options,['RETIRAR CAPA']);
});
test('Full call has exact label',()=>{
 assert.equal(formatDispatchText('MERCADO LIVRE','Full'),'MERCADO LIVRE RETIRAR CAPA FULL');
 assert.equal(formatDispatchText('MERCADO LIVRE NOVO','Full Mercado Livre Novo'),
  'MERCADO LIVRE NOVO RETIRAR CAPA FULL');
});
test('per-platform custom choices do not leak to other platforms',()=>{
 const config={'SHEIN':['Coleta expressa'],'SHOPEE':['Full']};
 assert.equal(dispatchOptionValid('SHEIN','Coleta expressa',config),true);
 assert.equal(dispatchOptionValid('SHOPEE','Coleta expressa',config),false);
 assert.equal(dispatchOptionValid('SHEIN','Full',config),false);
});
test('invalid configuration rejected without contacting Supabase',async()=>{
 for(const options of [['RETIRAR CAPA'],['Full','full'],[''],['X'.repeat(61)]]){
  const response=await handleNotificationDispatchRequest(
    new Request('https://example.com/api/admin/dispatch/options',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({platform:'SHEIN',options})
    }),{}
  );
  assert.equal(response.status,400);
 }
});
test('migration protects saved options and queue',()=>{
 const sql=fs.readFileSync(new URL('../supabase/migrations/20261021230000_nisti_dispatch_custom_options_v4.sql',import.meta.url),'utf8');
 assert.match(sql,/nisti_dispatch_enqueue_batch_v4/);
 assert.match(sql,/dispatch_option_not_allowed/);
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.nisti_dispatch_save_options_v4/);
});
test('startup installer configures current Windows user',()=>{
 const cmd=fs.readFileSync(new URL('../scripts/instalar-monitor-nisti.cmd',import.meta.url),'utf8');
 assert.match(cmd,/APPDATA/);
 assert.match(cmd,/NISTI-Monitor\.cmd/);
 assert.doesNotMatch(cmd,/(?:net user|autologon|reg add)/i);
});
