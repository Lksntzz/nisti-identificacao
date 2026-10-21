import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {encryptDump,validateEncryptedDump,decryptDump,inspectEncryptedDump,
  assertBackupPassphrase} from '../scripts/nisti-drive-backup.mjs';

const SECRET='Senha de backup NISTI ficticia 35 caracter';
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nisti-crypto-test-'));
  const data=Buffer.from('PGDMP'+('POSTGRES_BACKUP_FIXTURE\n'.repeat(500)));
  const source=path.join(dir,'snapshot.dump');
  const encrypted=path.join(dir,'snapshot.nisti.enc');
  fs.writeFileSync(source,data);
  return {dir,data,source,encrypted};
}
test('backup AES-256-GCM decrypts to exact binary without leaking plaintext in ciphertext',async()=>{
  const f=fixture();
  const destination=fs.mkdtempSync(path.join(os.tmpdir(),'nisti-recover-test-'));
  try{
    await encryptDump(f.source,f.encrypted,SECRET);
    const encrypted=fs.readFileSync(f.encrypted);
    assert.equal(encrypted.subarray(0,9).toString('ascii'),'NISTIENC1');
    assert.equal(encrypted.includes(Buffer.from('POSTGRES_BACKUP_FIXTURE')),false);
    const check=await validateEncryptedDump(f.encrypted,SECRET);
    assert.equal(check.plaintextBytes,f.data.length);
    const decrypted=await decryptDump(f.encrypted,destination,SECRET);
    assert.deepEqual(fs.readFileSync(decrypted),f.data);
    await assert.rejects(encryptDump(f.source,f.encrypted,SECRET),/EEXIST|file already exists/);
  }finally{
    fs.rmSync(f.dir,{recursive:true,force:true});
    fs.rmSync(destination,{recursive:true,force:true});
  }
});
test('wrong password and tampering never validate, partial plaintext is deleted',async()=>{
  const f=fixture();
  const dest=fs.mkdtempSync(path.join(os.tmpdir(),'nisti-recover-test-'));
  try{
    await encryptDump(f.source,f.encrypted,SECRET);
    await assert.rejects(validateEncryptedDump(f.encrypted,'Senha incorreta e longa demais para autenticar'));
    await assert.rejects(decryptDump(f.encrypted,dest,'Senha incorreta e longa demais para autenticar'),
      /Senha incorreta ou backup inválido/);
    assert.equal(fs.readdirSync(dest).length,0);
    const file=fs.readFileSync(f.encrypted);
    file[file.length-20]^=0xff;
    fs.writeFileSync(f.encrypted,file);
    await assert.rejects(validateEncryptedDump(f.encrypted,SECRET));
  }finally{
    fs.rmSync(f.dir,{recursive:true,force:true});
    fs.rmSync(dest,{recursive:true,force:true});
  }
});
test('passphrase is compulsory and never printed or hardcoded in the backup script',()=>{
  assert.throws(()=>assertBackupPassphrase('abc'),/pelo menos 20/);
  assert.throws(()=>assertBackupPassphrase(''),/pelo menos 20/);
  assert.equal(assertBackupPassphrase(SECRET),true);
  const script=fs.readFileSync('scripts/nisti-drive-backup.mjs','utf8');
  assert.match(script,/NISTI_BACKUP_PASSPHRASE/);
  assert.match(script,/await backup\(directory\)/);
  assert.match(script,/await rm\(directory,\{recursive:true,force:true\}\)/);
  assert.match(script,/await validateEncryptedDump\(encrypted,passphrase\)/);
  assert.match(script,/encryptedSha256/);
  assert.match(script,/includesR2Images:false/);
  assert.doesNotMatch(script,/upload_file|googleapis|drive\.google\.com\/upload/);
});

test('encrypted archive inspection temporarily decrypts for pg_restore and always cleans up',async()=>{
  const f=fixture();
  let inspectedPath=null;
  try{
    await encryptDump(f.source,f.encrypted,SECRET);
    const result=await inspectEncryptedDump(f.encrypted,SECRET,async archive=>{
      inspectedPath=archive;
      assert.ok(archive.endsWith('.dump'));
      assert.deepEqual(fs.readFileSync(archive),f.data);
    });
    assert.equal(result.archiveReadable,true);
    assert.equal(result.plaintextBytes,f.data.length);
    assert.equal(fs.existsSync(inspectedPath),false);

    let failedPath=null;
    await assert.rejects(inspectEncryptedDump(f.encrypted,SECRET,async archive=>{
      failedPath=archive;
      throw Error('catálogo inválido de teste');
    }),/catálogo inválido/);
    assert.equal(fs.existsSync(failedPath),false);
    await assert.rejects(inspectEncryptedDump(f.encrypted,'senha-errada-longa-e-distinta-123',async()=>{
      assert.fail('não deve chamar pg_restore se a senha for inválida');
    }));
    await assert.rejects(inspectEncryptedDump('arquivo.zip',SECRET,async()=>{}),/\.nisti\.enc/);
  }finally{
    fs.rmSync(f.dir,{recursive:true,force:true});
  }
});

test('backup inspection never connects to remote PostgreSQL or writes to Drive',()=>{
  const script=fs.readFileSync('scripts/nisti-drive-backup.mjs','utf8');
  assert.match(script,/spawn\('pg_restore',\['--list',archivePath\]/);
  assert.match(script,/await rm\(temp,\{recursive:true,force:true\}\)/);
  assert.match(script,/action==='inspect'/);
  assert.doesNotMatch(script,/pg_restore.*--dbname|pg_restore.*--clean/);
});
