// Backup for Google Drive: encrypt BEFORE any sync/upload. Plaintext is kept
// only in a temporary, local directory and removed after the attempt.
// No credentials, database connections, Google tokens or encryption keys here.
import { randomBytes, scryptSync, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, chmod, lstat, mkdtemp, open, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { backup, verifiedPrivateDestination } from './nisti-free-backup.mjs';

const MAGIC=Buffer.from('NISTIENC1','ascii');
const SALT_LEN=16,IV_LEN=12,TAG_LEN=16,HEADER_LEN=MAGIC.length+SALT_LEN+IV_LEN;
const ALGORITHM='aes-256-gcm';

export function assertBackupPassphrase(passphrase) {
  if(typeof passphrase!=='string'||passphrase.length<20||passphrase.length>4096)
    throw Error('Defina NISTI_BACKUP_PASSPHRASE com uma senha exclusiva de pelo menos 20 caracteres. Guarde-a fora do Drive.');
  return true;
}
function keyFor(passphrase,salt) {
  assertBackupPassphrase(passphrase);
  return scryptSync(passphrase,salt,32,{N:16384,r:8,p:1,maxmem:32*1024*1024});
}
export async function sha256(file) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}
async function encryptedParts(filename) {
  const handle=await open(filename,'r');
  try{
    const info=await handle.stat();
    if(info.size<HEADER_LEN+TAG_LEN+32)
      throw Error('Arquivo criptografado incompleto.');
    const header=Buffer.alloc(HEADER_LEN),tag=Buffer.alloc(TAG_LEN);
    const a=await handle.read(header,0,HEADER_LEN,0);
    const b=await handle.read(tag,0,TAG_LEN,info.size-TAG_LEN);
    if(a.bytesRead!==HEADER_LEN||b.bytesRead!==TAG_LEN||
      !header.subarray(0,MAGIC.length).equals(MAGIC))
      throw Error('Formato do backup não reconhecido.');
    return {
      salt:header.subarray(MAGIC.length,MAGIC.length+SALT_LEN),
      iv:header.subarray(MAGIC.length+SALT_LEN),
      tag, size:info.size
    };
  }finally{await handle.close();}
}
export async function encryptDump(source,destination,passphrase) {
  assertBackupPassphrase(passphrase);
  if(!source.endsWith('.dump')||path.resolve(source)===path.resolve(destination))
    throw Error('Somente arquivos PostgreSQL .dump podem ser criptografados.');
  const {salt,iv}={salt:randomBytes(SALT_LEN),iv:randomBytes(IV_LEN)};
  const cipher=createCipheriv(ALGORITHM,keyFor(passphrase,salt),iv);
  // Reserve before entering cleanup: never delete an existing backup on EEXIST.
  const reserved=await open(destination,'wx',0o600);
  await reserved.close();
  const output=createWriteStream(destination,{flags:'w',mode:0o600});
  try{
    output.write(Buffer.concat([MAGIC,salt,iv]));
    await pipeline(createReadStream(source),cipher,output);
    await appendFile(destination,cipher.getAuthTag());
    return destination;
  }catch(error) {
    output.destroy();
    await unlink(destination).catch(()=>{});
    throw error;
  }
}
async function decryptedStreamTo(filename,passphrase,target) {
  const parts=await encryptedParts(filename);
  const decipher=createDecipheriv(ALGORITHM,keyFor(passphrase,parts.salt),parts.iv);
  decipher.setAuthTag(parts.tag);
  await pipeline(
    createReadStream(filename,{start:HEADER_LEN,end:parts.size-TAG_LEN-1}),
    decipher,target
  );
}
export async function validateEncryptedDump(filename,passphrase) {
  const digest=createHash('sha256');
  let size=0;
  await decryptedStreamTo(filename,passphrase,new Writable({
    write(chunk,_encoding,done){size+=chunk.length;digest.update(chunk);done();}
  }));
  return {sha256:digest.digest('hex'),plaintextBytes:size};
}
export async function decryptDump(filename,folder,passphrase) {
  const destination=await verifiedPrivateDestination(folder);
  if(!filename.endsWith('.nisti.enc'))
    throw Error('Extensão de backup não reconhecida.');
  const result=path.join(destination,path.basename(filename,'.nisti.enc')+'.dump');
  const reserved=await open(result,'wx',0o600);
  await reserved.close();
  const out=createWriteStream(result,{flags:'w',mode:0o600});
  try{
    await decryptedStreamTo(filename,passphrase,out);
    return result;
  }catch(error){
    out.destroy();
    await unlink(result).catch(()=>{});
    throw Error('Senha incorreta ou backup inválido. Nenhum arquivo recuperado foi preservado.');
  }
}
export async function backupEncryptedForDrive(folder,passphrase) {
  assertBackupPassphrase(passphrase);
  const destination=await verifiedPrivateDestination(folder);
  const directory=await mkdtemp(path.join(tmpdir(),'nisti-supabase-temp-'));
  await chmod(directory,0o700);
  let encrypted=null,manifest=null;
  try{
    // Uses existing 100 MB default DB size cap BEFORE any pg_dump.
    const result=await backup(directory);
    const name=path.basename(result.archive,'.dump');
    encrypted=path.join(destination,name+'.nisti.enc');
    manifest=path.join(destination,name+'.nisti.json');
    const originalHash=await sha256(result.archive);
    await encryptDump(result.archive,encrypted,passphrase);
    const verified=await validateEncryptedDump(encrypted,passphrase);
    if(verified.sha256!==originalHash)throw Error('Falha ao conferir a integridade do backup criptografado.');
    await writeFile(manifest,JSON.stringify({
      type:'NISTI encrypted PostgreSQL backup',
      format:'NISTIENC1',algorithm:ALGORITHM,
      createdAt:new Date().toISOString(),
      encryptedFile:path.basename(encrypted),
      encryptedSha256:await sha256(encrypted),
      originalDatabaseBytes:result.usage.bytes,
      originalArchiveBytes:verified.plaintextBytes,
      includesR2Images:false,
      restoreTested:false
    },null,2)+'\n',{flag:'wx',mode:0o600});
    return {encrypted,manifest,usage:result.usage};
  }catch(error){
    if(encrypted)await unlink(encrypted).catch(()=>{});
    if(manifest)await unlink(manifest).catch(()=>{});
    throw error;
  }finally{
    // Never sync or upload raw database dumps.
    await rm(directory,{recursive:true,force:true});
  }
}
async function main() {
  const [action,arg1,arg2,arg3,arg4]=process.argv.slice(2);
  if(action==='plan'){
    console.log('Backup criptografado e privado para Google Drive, sem cobrança de serviços.');
    console.log('Banco: execução manual com limite padrão de 100 MB, sem agendamento.');
    console.log('Aponte --output-dir para pasta PRIVADA local, ou Drive para computador já sincronizado.');
    console.log('Não salve a senha dentro do Google Drive; não envie .dump sem criptografia.');
    return;
  }
  const secret=process.env.NISTI_BACKUP_PASSPHRASE;
  assertBackupPassphrase(secret);
  if(action==='backup'&&arg1==='--output-dir'&&arg2&&!arg3){
    const result=await backupEncryptedForDrive(arg2,secret);
    console.log('Backup criptografado criado: '+path.basename(result.encrypted));
    console.log('Banco estimado em '+result.usage.usedMb+' MB. Verificação AES-GCM e SHA-256 concluída.');
    console.log('Confirme o envio do arquivo .nisti.enc e .nisti.json na pasta Google Drive privada.');
    return;
  }
  if(action==='verify'&&arg1==='--file'&&arg2&&!arg3){
    const verified=await validateEncryptedDump(arg2,secret);
    console.log('Backup íntegro: '+verified.plaintextBytes+' bytes de arquivo PostgreSQL descriptografados e verificados em memória.');
    return;
  }
  if(action==='decrypt'&&arg1==='--file'&&arg2&&arg3==='--output-dir'&&arg4){
    const result=await decryptDump(arg2,arg4,secret);
    console.log('Arquivo PostgreSQL recuperado localmente (NUNCA enviar este .dump ao Drive): '+result);
    return;
  }
  throw Error('Use plan, backup --output-dir <pasta>, verify --file <arquivo> ou decrypt --file <arquivo> --output-dir <pasta>.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{console.error('Falha segura: '+String(error?.message||error));process.exitCode=1;});
}
