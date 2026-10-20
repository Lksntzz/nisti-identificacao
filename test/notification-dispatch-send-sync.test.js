import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {submitDispatchNotifications} from '../src/notification-dispatch-send.js';

const options={
  SHOPEE:['Full','Coleta personalizada'],
  SHEIN:['Empresa'],
  AMAZON:['Full']
};

test('modalidades personalizadas salvas são aceitas quando confirmadas pelo servidor',async()=>{
  const pending={current:null};
  let sent;
  const result=await submitDispatchNotifications({
    platforms:['SHOPEE'],
    optionFor:()=> 'Coleta personalizada',
    fetchOptions:async()=>({options}),
    enqueue:async calls=>{sent=calls;return {items:[{id:1234}]}},
    pendingBatch:pending,
    newRequestKey:()=> '123e4567-e89b-42d3-a456-426614174001'
  });
  assert.equal(result.state,'sent');
  assert.equal(sent[0].option,'Coleta personalizada');
  assert.equal(sent[0].platform,'SHOPEE');
  assert.equal(result.data.items[0].id,1234);
  assert.equal(pending.current,null);
});

test('não envia modalidade removida em outra tela; recarrega configuração antes',async()=>{
  const pending={current:[{platform:'SHOPEE',option:'Removida',request_key:'old-key'}]};
  let enqueueCalled=false;
  const result=await submitDispatchNotifications({
    platforms:['SHOPEE'],
    optionFor:()=> 'Removida',
    fetchOptions:async()=>({options}),
    enqueue:async()=>{enqueueCalled=true},
    pendingBatch:pending
  });
  assert.equal(result.state,'options_changed');
  assert.deepEqual(result.unavailable,['SHOPEE']);
  assert.equal(enqueueCalled,false);
  assert.equal(pending.current,null);
});

test('plataforma e modalidade são validadas juntas, inclusive envio combinado',async()=>{
  let enqueued=false;
  const result=await submitDispatchNotifications({
    platforms:['SHOPEE','SHEIN'],
    optionFor:name=>name==='SHOPEE'?'Coleta personalizada':'Coleta personalizada',
    fetchOptions:async()=>({options}),
    enqueue:async()=>{enqueued=true},
    pendingBatch:{current:null}
  });
  assert.deepEqual(result.unavailable,['SHEIN']);
  assert.equal(enqueued,false);
});

test('falha de conexão preserva os IDs para repetir envio sem duplicar chamadas',async()=>{
  const pending={current:null};
  const keys=['123e4567-e89b-42d3-a456-426614174002'];
  let postCount=0;
  const common={
    platforms:['SHOPEE'], optionFor:()=> 'Coleta personalizada',
    fetchOptions:async()=>({options}),
    pendingBatch:pending,
    newRequestKey:()=>{if(keys.length===0)throw Error('nova chave indevida');return keys.shift()},
  };
  await assert.rejects(submitDispatchNotifications({
    ...common,enqueue:async()=>{postCount++;throw Error('network timeout')}
  }),/network timeout/);
  assert.equal(pending.current[0].request_key,'123e4567-e89b-42d3-a456-426614174002');
  const result=await submitDispatchNotifications({
    ...common,enqueue:async calls=>{
      postCount++;assert.equal(calls[0].request_key,'123e4567-e89b-42d3-a456-426614174002');
      return {items:[{id:4}]};
    }
  });
  assert.equal(result.state,'sent');
  assert.equal(postCount,2);
  assert.equal(pending.current,null);
});

test('sem configuração autorizada não cria fila nem assume opção disponível',async()=>{
  let called=false;
  await assert.rejects(
    submitDispatchNotifications({
      platforms:['SHOPEE'],optionFor:()=> 'Full',
      fetchOptions:async()=>({options:null}),
      enqueue:async()=>{called=true},
      pendingBatch:{current:null}
    }),
    /Não foi possível conferir/
  );
  assert.equal(called,false);
});

test('a interface separa envio confirmado da atualização de contadores',()=>{
  const jsx=fs.readFileSync(new URL('../src/admin/NotificationDispatchView.jsx',import.meta.url),'utf8');
  assert.match(jsx,/await submitDispatchNotifications\(/);
  assert.match(jsx,/fetchOptions:\(\)=>request\(endpoints.options\)/);
  assert.match(jsx,/result.state==='options_changed'/);
  assert.match(jsx,/setSuccess\(\(data.items\?\.length\|\|platforms.length\)/);
  assert.match(jsx,/await refresh\(\{silent:true\}\)/);
  assert.match(jsx,/if\(!silent\)setError\(e.message\)/);
});
