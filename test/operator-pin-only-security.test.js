import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import edgeRouter from '../src/edge-router.js';
import {operatorPinDigest,validOperatorPin} from '../src/operator-pin-access.js';

const sql=fs.readFileSync('supabase/migrations/20261019235900_nisti_operator_pin_only_v1.sql','utf8');
const edge=fs.readFileSync('src/edge-router.js','utf8');
const gate=fs.readFileSync('src/operator-pin-gate.jsx','utf8');

test('PIN possui exatamente oito dígitos; HMAC não expõe nem armazena PIN',async()=>{
  const env={OPERATOR_PIN_PEPPER:'a-secure-independent-test-pepper-with-at-least-32-bytes'};
  assert.equal(validOperatorPin('12345678'),true);
  for(const bad of ['1234','0000000','123456789','abcdef12',12345678,null])
    assert.equal(validOperatorPin(bad),false,String(bad));
  const hash=await operatorPinDigest(env,'12345678');
  assert.match(hash,/^[0-9a-f]{64}$/);
  assert.equal(hash,await operatorPinDigest(env,'12345678'));
  assert.notEqual(hash,await operatorPinDigest(env,'12345679'));
  assert.doesNotMatch(hash,/12345678/);
  await assert.rejects(operatorPinDigest({},'12345678'),/operator_pin_pepper_unavailable/);
});

test('SQL garante PIN HMAC, row security e leitura exclusiva pelo serviço',()=>{
  assert.match(sql,/pin_digest text NOT NULL UNIQUE/);
  assert.match(sql,/ALTER TABLE public.nisti_operator_pin_accounts ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/ALTER TABLE public.nisti_operator_pin_settings ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/FROM public,anon,authenticated/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
  assert.match(sql,/pin_required boolean NOT NULL DEFAULT false/);
  assert.match(sql,/INSERT INTO public.nisti_operator_pin_settings/);
  assert.match(sql,/credential_version=credential_version\+1/);
  assert.doesNotMatch(sql,/\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:FROM\s+)?public\.(?:products|product_gtins|gtin_scan_events)/i);
});

test('operadores têm sessão associada ao PIN, não gerada automaticamente após ativar',()=>{
  assert.match(edge,/session\?\.pin/);
  assert.match(edge,/operatorPinSessionInfo\(env,session\.id\)/);
  assert.match(edge,/account\.version\)!==session\.version/);
  assert.match(edge,/code:'operator_pin_required'/);
  assert.match(edge,/headers\.set\('x-operator-name',encodeURIComponent\(verifiedName\)\)/);
  assert.match(gate,/type="password" inputMode="numeric"/);
  assert.match(gate,/body:JSON\.stringify\(\{pin\}\)/);
  assert.doesNotMatch(gate,/localStorage|sessionStorage/);
});

test('PIN de operador autentica no servidor e impede falsificação do x-user-id',async()=>{
  const original=globalThis.fetch;
  const pepper='independent-hmac-pepper-for-pin-test-at-least-thirty-two-characters';
  const validDigest=await operatorPinDigest({OPERATOR_PIN_PEPPER:pepper},'12847063');
  const operator={id:'op_123e4567-e89b-42d3-a456-426614174000',name:'Operador Expedição',version:1};
  globalThis.fetch=async (url,options)=>{
    const name=String(url).split('/rpc/')[1];
    const body=JSON.parse(options.body||'{}');
    let result;
    switch(name){
      case 'nisti_operator_pin_required_v1':result=true;break;
      case 'nisti_operator_pin_signin_v1':result=body.p_digest===validDigest?operator:null;break;
      case 'nisti_operator_pin_session_v1':result=body.p_id===operator.id?operator:null;break;
      default:throw Error('Unexpected Supabase function '+name);
    }
    return new Response(JSON.stringify(result),{headers:{'content-type':'application/json'}});
  };
  const env={
    APP_ENV:'production',SUPABASE_URL:'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY:'test-only-service-key',
    OPERATOR_PIN_PEPPER:pepper,ADMIN_PASSWORD:'a-test-admin-secret',
    LOGIN_RATE_LIMITER:{limit:async()=>({success:true})}
  };
  try{
    const origin='https://sistemanistiid.online';
    let unauth=await edgeRouter.fetch(new Request(origin+'/api/operator/session'),env,{});
    assert.deepEqual(await unauth.json(),{required:true,authenticated:false});
    let forged=await edgeRouter.fetch(new Request(origin+'/api/notifications',{
      headers:{'x-user-id':operator.id}
    }),env,{});
    assert.equal(forged.status,401);
    let rejected=await edgeRouter.fetch(new Request(origin+'/api/operator/login',{
      method:'POST',headers:{origin,'content-type':'application/json'},
      body:JSON.stringify({pin:'00000000'})
    }),env,{});
    assert.equal(rejected.status,401);
    let authorized=await edgeRouter.fetch(new Request(origin+'/api/operator/login',{
      method:'POST',headers:{origin,'content-type':'application/json'},
      body:JSON.stringify({pin:'12847063'})
    }),env,{});
    assert.equal(authorized.status,200);
    const cookie=authorized.headers.get('set-cookie')?.split(';')[0];
    assert.match(cookie||'',/^nisti_operator_session=/);
    assert.match(authorized.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
    let current=await edgeRouter.fetch(new Request(origin+'/api/operator/session',{
      headers:{cookie}
    }),env,{});
    assert.deepEqual(await current.json(),{required:true,authenticated:true,name:operator.name});
    let admin=await edgeRouter.fetch(new Request(origin+'/api/admin/operator-pins'),env,{});
    assert.equal(admin.status,401);
    let logout=await edgeRouter.fetch(new Request(origin+'/api/operator/logout',{
      method:'POST',headers:{origin,cookie}
    }),env,{});
    assert.equal(logout.status,200);
    assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
  }finally{globalThis.fetch=original}
});

test('bipagens com PIN ignoram nome livre do JSON e verificam o marcador de sessão',()=>{
  const gtin=fs.readFileSync('src/gtin-router.js','utf8');
  assert.match(edge,/headers\.delete\('x-operator-verified'\)/);
  assert.match(edge,/headers\.set\('x-operator-verified','pin'\)/);
  assert.match(gtin,/request\.headers\.get\('x-operator-verified'\)==='pin'/);
  assert.match(gtin,/verifiedPin \? null : cleanEventText\(body\?\.operator_name\)/);
  assert.match(gtin,/verifiedPin \|\| !operatorName/);
});
