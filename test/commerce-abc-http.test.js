// GA-P01 — leitura dos parâmetros da rota do histórico e resposta com métricas (sem rede, sem banco).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAbcHistoryRequest, abcJsonResponse, MAX_BODY_CHARS } from '../src/ga/commerce-abc-http.js';

const u=(o)=>{const x=new URL('https://ga.invalid/api/admin/commerce/abc-evolution/history');for(const [k,v] of Object.entries(o))if(v!=null)x.searchParams.set(k,v);return x;};
const ok={platform:'shopee',mode:'7d',last:'2026-11-23',version:'abc123'};
const body={skus:['AAA','BBB']};

test('parâmetros válidos: conta em maiúsculas, mês opcional, SKUs só no corpo',()=>{
  const r=parseAbcHistoryRequest(u(ok),body); assert.equal(r.error,undefined);
  assert.deepEqual(r.value,{platform:'SHOPEE',mode:'7d',month:null,last:'2026-11-23',dataVersion:'abc123',skus:['AAA','BBB']});
  assert.equal(parseAbcHistoryRequest(u({...ok,mode:'mensal',month:'2026-10'}),body).value.month,'2026-10');
});
test('parâmetros inválidos viram erro (nada é "corrigido" em silêncio)',()=>{
  for(const bad of [{platform:'TODAS'},{platform:null},{mode:'60d'},{mode:null},{month:'2026-13'},{last:'2026-02-30'},{last:null},{version:null},{version:''},{version:'x'.repeat(201)}])
    assert.ok(parseAbcHistoryRequest(u({...ok,...bad}),body).error,JSON.stringify(bad).slice(0,50));
  for(const bad of [undefined,null,{},{skus:null},{skus:'AAA'},{skus:[1]},{skus:['']},{skus:['x'.repeat(121)]},{skus:Array.from({length:201},(_,i)=>'S'+i)}])
    assert.ok(parseAbcHistoryRequest(u(ok),bad).error,JSON.stringify(bad)?.slice(0,50));
});
test('SKUs na URL são recusados (não podem aparecer em logs de infraestrutura)',()=>{
  assert.ok(parseAbcHistoryRequest(u({...ok,skus:'["AAA"]'}),body).error);
});
test('200 SKUs de 120 caracteres cabem no limite do corpo; lista vazia é aceita',()=>{
  const big={skus:Array.from({length:200},(_,i)=>String(i).padStart(120,'S'))};
  assert.ok(JSON.stringify(big).length<=MAX_BODY_CHARS); assert.equal(parseAbcHistoryRequest(u(ok),big).value.skus.length,200);
  assert.deepEqual(parseAbcHistoryRequest(u(ok),{skus:[]}).value.skus,[]);
});
test('resposta com métricas: tamanho em bytes no corpo e no cabeçalho, sem cache, sem dados do negócio no log',async()=>{
  const logs=[];const real=console.log;console.log=(...a)=>logs.push(a.join(' '));
  try{
    const body={status:'OK',platform:'SHOPEE',mode:'7d',metrics:{elapsed_ms:1234,queries:9,failed:[],failed_count:0},comparison:{entries:[{sku:'SEGREDO-123'}]}};
    const res=abcJsonResponse(body,'indicators'); const txt=await res.text(); const j=JSON.parse(txt);
    assert.equal(res.status,200); assert.equal(res.headers.get('cache-control'),'no-store'); assert.match(res.headers.get('content-type'),/json/);
    assert.ok(j.metrics.response_bytes>0); assert.equal(Number(res.headers.get('x-ga-response-bytes')),j.metrics.response_bytes);
    assert.ok(Math.abs(new TextEncoder().encode(txt).length-j.metrics.response_bytes)<64,'o tamanho informado é o do corpo (sem o próprio campo)');
    assert.equal(logs.length,1); const l=JSON.parse(logs[0]); assert.deepEqual([l.ev,l.kind,l.platform,l.mode,l.status,l.ms,l.queries,l.failed_count],['ga_abc','indicators','SHOPEE','7d','OK',1234,9,0]);
    assert.ok(!logs[0].includes('SEGREDO'),'o log não leva SKU nem vendas');
  }finally{console.log=real;}
});
test('resposta sem métricas continua válida',async()=>{
  const real=console.log;console.log=()=>{};
  try{const res=abcJsonResponse({status:'INVALIDO'},'history'); assert.equal((await res.json()).status,'INVALIDO');}finally{console.log=real;}
});
