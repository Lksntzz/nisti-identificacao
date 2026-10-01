import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [, , queryFile = 'export/products.json', outputRoot = 'export'] = process.argv;
const imagesDir = path.join(outputRoot, 'original-images');
const temporaryDir = path.join(outputRoot, '.temporary');
const bucket = 'nisti-identificacao-images';
const concurrency = 4;

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function safeName(value) {
  return String(value || 'SEM-SKU')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100) || 'SEM-SKU';
}

function imageExtension(bytes, objectKey) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (bytes.length >= 6 && ['GIF87a','GIF89a'].includes(bytes.subarray(0, 6).toString())) return 'gif';
  if (bytes.length >= 12 && bytes.subarray(4, 12).toString().includes('ftyp')) return 'avif';
  const extension = path.extname(String(objectKey || '')).replace(/^\./, '').toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(extension) ? extension : 'img';
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio:['ignore','pipe','pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `${command} terminou com código ${code}`));
    });
  });
}

const raw = JSON.parse(await readFile(queryFile, 'utf8'));
const batches = Array.isArray(raw) ? raw : [raw];
const products = batches.flatMap(batch => Array.isArray(batch?.results) ? batch.results : []);
const rows = products
  .filter(product => product?.image_key)
  .sort((a, b) => Number(a.id || 0) - Number(b.id || 0));

await rm(imagesDir, { recursive:true, force:true });
await rm(temporaryDir, { recursive:true, force:true });
await mkdir(imagesDir, { recursive:true });
await mkdir(temporaryDir, { recursive:true });

const manifest = [['id','sku','original_object_key','file_name','status','error']];
const failures = [];
let cursor = 0;
let completed = 0;

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= rows.length) return;
    const product = rows[index];
    const id = Number(product.id || 0);
    const sku = String(product.sku || 'SEM-SKU');
    const temporaryFile = path.join(temporaryDir, `${id}.bin`);
    let finalName = '';
    try {
      await run('npx', [
        'wrangler','r2','object','get',`${bucket}/${product.image_key}`,
        '--file',temporaryFile
      ]);
      const bytes = await readFile(temporaryFile);
      const extension = imageExtension(bytes, product.image_key);
      finalName = `${String(index + 1).padStart(4, '0')}_${safeName(sku)}_${id}.${extension}`;
      await rename(temporaryFile, path.join(imagesDir, finalName));
      manifest.push([id,sku,product.image_key,finalName,'ok','']);
    } catch (error) {
      const message = String(error?.message || error).slice(0, 600);
      failures.push({ id, sku, image_key:product.image_key, error:message });
      manifest.push([id,sku,product.image_key,finalName,'failed',message]);
    }
    completed += 1;
    console.log(`[export] ${completed}/${rows.length} - ${sku}`);
  }
}

await Promise.all(Array.from({ length:Math.min(concurrency, Math.max(1, rows.length)) }, worker));
await rm(temporaryDir, { recursive:true, force:true });
await writeFile(
  path.join(outputRoot, 'manifest.csv'),
  manifest.map(row => row.map(csvCell).join(',')).join('\n') + '\n',
  'utf8'
);
await writeFile(
  path.join(outputRoot, 'export-summary.json'),
  JSON.stringify({ total:rows.length, exported:rows.length - failures.length, failed:failures.length, failures }, null, 2),
  'utf8'
);
await writeFile(path.join(outputRoot, 'failures.txt'), failures.map(item => `${item.id}\t${item.sku}\t${item.error}`).join('\n'), 'utf8');

console.log(JSON.stringify({ total:rows.length, exported:rows.length - failures.length, failed:failures.length }));
