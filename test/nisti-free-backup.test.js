import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { quotaSummary,maxBackupMb,isOutsideRepo,requiresConnection,verifiedPrivateDestination }
  from '../scripts/nisti-free-backup.mjs';

test('500 MB free quota is measured without creating tables or expanding the database',()=>{
  const s=quotaSummary(69758099);
  assert.equal(s.quotaMb,500);
  assert.equal(s.usedPercent,13.31);
  assert.equal(s.warning,false);
  assert.equal(s.critical,false);
  assert.equal(quotaSummary(400*1048576).warning,true);
  assert.equal(quotaSummary(450*1048576).critical,true);
  assert.throws(()=>quotaSummary(-5),/inválido/);
  assert.throws(()=>quotaSummary(NaN),/inválido/);
});

test('backup transfer limit is 100 MB default and can only be deliberately raised to 500 MB',()=>{
  assert.equal(maxBackupMb(),100);
  assert.equal(maxBackupMb('100'),100);
  assert.equal(maxBackupMb('200'),200);
  for(const value of ['0','501','infinite','2.5','']) {
    if(value==='')assert.equal(maxBackupMb(value),100);
    else assert.throws(()=>maxBackupMb(value),/inteiro entre/);
  }
});

test('backup requires explicit local database environment with TLS',()=>{
  const valid={PGHOST:'aws-0-sa-east-1.pooler.supabase.com',PGUSER:'postgres.test',
    PGDATABASE:'postgres',PGPASSWORD:'secret',PGSSLMODE:'require'};
  assert.equal(requiresConnection(valid),true);
  assert.throws(()=>requiresConnection({...valid,PGPASSWORD:''}),/PGPASSWORD/);
  assert.throws(()=>requiresConnection({...valid,PGHOST:'postgres://password@server'}),/somente o host/);
  assert.throws(()=>requiresConnection({...valid,PGDATABASE:'template1'}),/postgres/);
  assert.throws(()=>requiresConnection({...valid,PGSSLMODE:'disable'}),/PGSSLMODE/);
});

test('local backups cannot go to repository, checkout subdirectories or symlinked paths',async()=>{
  const repo=path.resolve(process.cwd());
  const outside=fs.mkdtempSync(path.join(os.tmpdir(),'nisti-backup-test-'));
  try{
    assert.equal(isOutsideRepo(repo,repo),false);
    assert.equal(isOutsideRepo(path.join(repo,'export'),repo),false);
    assert.equal(isOutsideRepo(outside,repo),true);
    assert.equal(await verifiedPrivateDestination(outside),fs.realpathSync(outside));
    await assert.rejects(verifiedPrivateDestination(repo),/fora do repositório|Destino dentro/);
    await assert.rejects(verifiedPrivateDestination('relative-path'),/ABSOLUTA/);
    const link=path.join(outside,'symlink-repo');
    try{
      fs.symlinkSync(repo,link,'dir');
      await assert.rejects(verifiedPrivateDestination(link),/pasta local existente|Destino dentro/);
    }catch(e){
      if(e.code!=='EPERM'&&e.code!=='EACCES')throw e;
    }
  }finally{fs.rmSync(outside,{recursive:true,force:true})}
});

test('backup scripts do not write to R2, Supabase Storage, or GitHub artifacts',()=>{
  const script=fs.readFileSync('scripts/nisti-free-backup.mjs','utf8');
  assert.match(script,/--format=custom/);
  assert.match(script,/--compress=6/);
  assert.match(script,/await command\('pg_restore',\['--list',archive\]/);
  assert.match(script,/await open\(archive,'wx',0o600\)/);
  assert.match(script,/includesR2Images:false/);
  assert.doesNotMatch(script,/wrangler.*r2.*object.*put|github\.com\/repos\/.*\/actions\/artifacts/);
  assert.match(script,/NISTI_BACKUP_MAX_MB/);
});
