// GA-P01 — limitador de consultas simultâneas por operação (sem rede, sem banco).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLimiter, MAX_PARALLEL_DB } from '../src/ga/commerce-concurrency.js';

const tick=()=>new Promise(r=>setImmediate(r));

test('limite padrão da operação é 3 consultas simultâneas',()=>{ assert.equal(MAX_PARALLEL_DB,3); });

test('nunca passa de 3 tarefas ao mesmo tempo e todas terminam, na ordem em que foram pedidas',async()=>{
  const run=makeLimiter(3);let active=0,peak=0;const started=[];
  const task=n=>run(async()=>{active++;peak=Math.max(peak,active);started.push(n);await tick();await tick();active--;return n;});
  const out=await Promise.all(Array.from({length:10},(_,i)=>task(i)));
  assert.deepEqual(out,[0,1,2,3,4,5,6,7,8,9]); assert.equal(peak,3); assert.deepEqual(started,[0,1,2,3,4,5,6,7,8,9],'fila em ordem');
});

test('tarefa que falha devolve o erro e libera a vaga (as outras seguem)',async()=>{
  const run=makeLimiter(1);const order=[];
  const a=run(async()=>{order.push('a');throw new Error('falhou');});
  const b=run(async()=>{order.push('b');return 'ok';});
  await assert.rejects(a,/falhou/); assert.equal(await b,'ok'); assert.deepEqual(order,['a','b']);
});

test('tarefa síncrona que lança também libera a vaga',async()=>{
  const run=makeLimiter(1);
  await assert.rejects(run(()=>{throw new Error('sync');}),/sync/);
  assert.equal(await run(()=>7),7);
});

test('limite inválido cai para 1 (nunca ilimitado); sem argumento vale o padrão de 3',async()=>{
  for(const bad of [0,-2,NaN,null,'x',1.5]){
    const run=makeLimiter(bad);let active=0,peak=0;
    await Promise.all([1,2,3].map(()=>run(async()=>{active++;peak=Math.max(peak,active);await tick();active--;})));
    assert.equal(peak,1,String(bad));
  }
});
