import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.existsSync(p)?fs.readFileSync(p,'utf8'):'';
const code=s=>s.split('\n').filter(l=>!/^\s*--/.test(l)).join('\n');

const GROUPS_SQL='supabase/migrations/20261123180000_commerce_problem_groups_v1.sql';
const groups=read(GROUPS_SQL),groupsCode=code(groups);

function assertReadOnlySecure(sql,fn){
  const c=code(sql);
  assert.ok(c.length>0,'migração existe');
  assert.match(c,new RegExp('create or replace function public\\.'+fn+'\\('));
  assert.match(c,/security invoker/);
  assert.match(c,/set search_path=public/);
  assert.match(c,/revoke all on function public\.[a-z_0-9]+\(integer\) from public,\s*anon,\s*authenticated/);
  assert.match(c,/grant execute on function public\.[a-z_0-9]+\(integer\) to service_role/);
  assert.doesNotMatch(c,/\b(insert\s+into|update\s+public|delete\s+from|drop\s+table|truncate)\b/i,'somente leitura');
}

test('grupos: função segura, somente leitura e só com janelas 30/60/90',()=>{
  assertReadOnlySecure(groups,'commerce_problem_groups_v1');
  assert.match(groupsCode,/p_days is null or p_days not in \(30,\s*60,\s*90\)/);
});
test('grupos: só anúncios ativos, plataforma pelo account_code e sem usar created_at do GA como idade',()=>{
  assert.match(groupsCode,/listing_status='ACTIVE'/);
  assert.match(groupsCode,/'ML_'\|\|l\.account_code/);
  assert.doesNotMatch(groupsCode,/created_at/);
});
test('grupos: valores do desenho (90 dias, 30%, 10 unidades, 1.000 impressões, 100 visitantes, metade da média)',()=>{
  assert.match(groupsCode,/e-90/);
  assert.match(groupsCode,/u_base>=10/);
  assert.match(groupsCode,/0\.7/);
  assert.match(groupsCode,/l_imp>=1000/);
  assert.match(groupsCode,/l_vis>=100/);
  assert.match(groupsCode,/0\.5\*/);
});
test('grupos: prioridade Parou > Em queda > Pior performance > Nunca vendeu em um só case',()=>{
  const m=/case\s+when\s+is_parou\s+then\s+'PAROU'\s+when\s+is_queda\s+then\s+'QUEDA'\s+when\s+is_pior\s+then\s+'PIOR'\s+when\s+is_nunca\s+then\s+'NUNCA'/.exec(groupsCode);
  assert.ok(m,'case de prioridade');
});
