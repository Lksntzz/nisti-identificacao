// Manual, free-tier-conscious backup. Writes ONLY on the operator's computer,
// never to Supabase Storage, R2, GitHub Actions artifacts or the repository.
// Requires locally installed PostgreSQL client v17 (psql, pg_dump, pg_restore).
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath, writeFile, unlink, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECK_SQL='select pg_database_size(current_database())';
const MIN_SIZE=1;
const MAX_SAFE_DEFAULT_MB=100;
const MAX_ADJUSTABLE_MB=500;
const REPO_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export function quotaSummary(bytes,quotaMb=500) {
  if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('Tamanho do banco inválido.');
  const limit=quotaMb*1024*1024;
  return {
    bytes,
    usedMb:Number((bytes/1048576).toFixed(2)),
    quotaMb,
    usedPercent:Number((100*bytes/limit).toFixed(2)),
    remainingMb:Number((Math.max(0,limit-bytes)/1048576).toFixed(2)),
    warning:bytes>=0.8*limit,
    critical:bytes>=0.9*limit
  };
}
export function maxBackupMb(raw) {
  if(raw==null||String(raw).trim()==='')return MAX_SAFE_DEFAULT_MB;
  const value=Number(raw);
  if(!Number.isInteger(value)||value<1||value>MAX_ADJUSTABLE_MB)
    throw Error('NISTI_BACKUP_MAX_MB deve ser um inteiro entre 1 e 500.');
  return value;
}
export function isOutsideRepo(realDir,realRepo=REPO_ROOT) {
  const base=path.resolve(realRepo);
  const dir=path.resolve(realDir);
  const rel=path.relative(base,dir);
  return rel==='..'||rel.startsWith('..'+path.sep) || path.isAbsolute(rel);
}
export function requiresConnection(env) {
  // Never accept a URL with embedded credentials or print connection strings.
  for(const k of ['PGHOST','PGUSER','PGDATABASE','PGPASSWORD']) {
    if(typeof env[k]!=='string'||!env[k].trim())
      throw Error(k+' não configurado no terminal local.');
  }
  if(env.PGHOST.includes('://')||env.PGHOST.includes('@'))
    throw Error('PGHOST deve conter somente o host, nunca uma URL ou senha.');
  if(env.PGDATABASE!=='postgres')
    throw Error('Backup permitido apenas do banco postgres. Confira a conexão.');
  if(env.PGSSLMODE&&env.PGSSLMODE!=='require'&&env.PGSSLMODE!=='verify-full')
    throw Error('Use PGSSLMODE=require ou verify-full.');
  return true;
}
async function command(bin,args,options={}) {
  return await new Promise((resolve,reject)=>{
    const child=spawn(bin,args,{
      env:{...process.env,PGSSLMODE:process.env.PGSSLMODE||'require'},
      stdio:['ignore','pipe','pipe'],shell:false
    });
    let out='',err='',killed=false;
    const timer=setTimeout(()=>{killed=true;child.kill('SIGKILL')},options.timeoutMs||120000);
    child.stdout.on('data',buf=>{
      if(out.length<128*1024)out+=buf.toString();
    });
    child.stderr.on('data',buf=>{
      if(err.length<8192)err+=buf.toString();
    });
    child.on('error',error=>{
      clearTimeout(timer);
      reject(Error('Ferramenta '+bin+' indisponível: verifique a instalação local.'));
    });
    child.on('close',code=>{
      clearTimeout(timer);
      if(code!==0)reject(Error(
        (killed?'Tempo de execução excedido. ':'')+
        bin+' terminou sem sucesso (código '+code+'). Verifique host, acesso e ferramentas locais.'
      ));
      else resolve(out);
    });
  });
}
export async function databaseUsage() {
  requiresConnection(process.env);
  const response=await command('psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',CHECK_SQL],{timeoutMs:20000});
  const size=Number(response.trim());
  if(!Number.isSafeInteger(size)||size<MIN_SIZE)
    throw Error('A consulta de tamanho não retornou valor válido.');
  return quotaSummary(size);
}
export async function verifiedPrivateDestination(folder) {
  if(typeof folder!=='string'||!path.isAbsolute(folder))
    throw Error('Informe uma pasta ABSOLUTA fora do repositório: --output-dir <pasta>.');
  const info=await lstat(folder);
  if(!info.isDirectory())throw Error('O destino deve ser uma pasta local existente.');
  const actual=await realpath(folder);
  if(!isOutsideRepo(actual))
    throw Error('Destino dentro do GitHub/repositório recusado: escolha pasta privada externa.');
  return actual;
}
async function sha256(file) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}
export async function backup(folder) {
  const destination=await verifiedPrivateDestination(folder);
  const usage=await databaseUsage();
  const maxMb=maxBackupMb(process.env.NISTI_BACKUP_MAX_MB);
  if(usage.bytes>maxMb*1048576)
    throw Error('Backup recusado pelo limite local de '+maxMb+
      ' MB. Tamanho estimado: '+usage.usedMb+' MB. Revise os custos de tráfego primeiro.');
  const date=new Date().toISOString().replace(/[:.]/g,'-');
  const base='nisti-supabase-'+date;
  const archive=path.join(destination,base+'.dump');
  const manifest=path.join(destination,base+'.json');
  // Reserve the file exclusively: a backup from another run is never overwritten.
  const reserved=await open(archive,'wx',0o600);
  await reserved.close();
  // pg_dump -Fc is compressed and allows inspection without a restore.
  try {
    await command('pg_dump',[
      '--format=custom','--compress=6','--no-owner','--no-acl',
      '--file='+archive
    ],{timeoutMs:300000});
    const dumped=await stat(archive);
    if(dumped.size<1024)throw Error('Backup retornou arquivo vazio ou inválido.');
    await command('pg_restore',['--list',archive],{timeoutMs:30000});
    const sum=await sha256(archive);
    await writeFile(manifest,JSON.stringify({
      format:'PostgreSQL custom archive',
      source:'Supabase PostgreSQL (manual export)',
      createdAt:new Date().toISOString(),
      estimatedDatabaseBytes:usage.bytes,
      quotaUsedPercent:usage.usedPercent,
      backupFile:path.basename(archive),
      sha256:sum,
      includesR2Images:false,
      restorationTested:false
    },null,2)+'\n',{flag:'wx',mode:0o600});
    return {archive,manifest,usage};
  }catch(error) {
    await unlink(archive).catch(()=>{});
    await unlink(manifest).catch(()=>{});
    throw error;
  }
}
async function main() {
  const action=process.argv[2];
  if(action==='plan') {
    console.log('Sem conexão ou escrita: plano gratuito Supabase 500 MB.');
    console.log('Confira o uso: node scripts/nisti-free-backup.mjs status');
    console.log('Backup manual no PC: node scripts/nisti-free-backup.mjs backup --output-dir C:\\Backup-NISTI');
    console.log('Máximo padrão de transferência por execução: 100 MB. Sem R2, sem agendamento, sem GitHub.');
    return;
  }
  if(action==='status') {
    const v=await databaseUsage();
    console.log(JSON.stringify(v,null,2));
    return;
  }
  if(action==='backup' && process.argv[3]==='--output-dir' && process.argv[4] && process.argv.length===5) {
    const result=await backup(process.argv[4]);
    console.log('Backup salvo localmente. Banco: '+result.usage.usedMb+' MB.');
    console.log('Arquivo e checksum SHA-256 disponíveis na pasta privada.');
    return;
  }
  throw Error('Use plan, status ou backup --output-dir <pasta absoluta privada>.');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(error=>{
    console.error('Falha segura: '+String(error?.message||error));
    process.exitCode=1;
  });
}
