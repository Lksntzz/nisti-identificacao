import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (filename) => readFileSync(filename, 'utf8');

test('produção consulta Supabase e mantém imagens no R2, sem D1 principal', () => {
  const config = read('wrangler.toml');
  assert.match(config, /^SUPABASE_WRITE_MODE = "primary"$/m);
  assert.match(config, /^SUPABASE_READS_ENABLED = "1"$/m);
  assert.match(config, /^binding = "PRODUCT_IMAGES"$/m);
  assert.doesNotMatch(config, /^\s*\[\[d1_databases\]\]/m);
});

test('exportação das imagens originais obtém o índice do Supabase, não do D1', () => {
  const workflow = read('.github/workflows/export-original-product-images.yml');
  assert.match(workflow, /node scripts\/export-original-image-index-supabase\.mjs export\/products\.json/);
  assert.match(workflow, /SUPABASE_SERVICE_ROLE_KEY:/);
  assert.match(workflow, /node scripts\/export-original-product-images\.mjs export\/products\.json export/);
  assert.doesNotMatch(workflow, /wrangler\s+d1|d1\s+execute|export-original-image-index-d1/i);
  // O artefato é privado, criptografado e de retenção curta: NÃO é backup completo.
  assert.match(workflow, /nisti-encrypt-image-export\.mjs encrypt/);
  assert.match(workflow, /retention-days:\s*1/);
});

test('snapshot da migração D1 não é confundido com backup atual do Supabase', () => {
  const workflow = read('.github/workflows/supabase-final-snapshot.yml');
  assert.match(workflow, /Export frozen D1 snapshot/);
  assert.match(workflow, /wrangler d1 export/);
  // Nunca trate esse workflow histórico como exportação do PostgreSQL.
  assert.doesNotMatch(workflow, /pg_dump|nisti-drive-backup\.mjs/);
});

test('backup PostgreSQL enviado ao Drive é criptografado e tem limite conservador', () => {
  const backup = read('scripts/nisti-drive-backup.mjs');
  const local = read('scripts/nisti-free-backup.mjs');
  assert.match(backup, /await backup\(directory\)/);
  assert.match(backup, /await encryptDump\(result\.archive,encrypted,passphrase\)/);
  assert.match(backup, /await validateEncryptedDump\(encrypted,passphrase\)/);
  assert.match(backup, /await rm\(directory,\{recursive:true,force:true\}\)/);
  assert.match(local, /MAX_SAFE_DEFAULT_MB=100/);
  assert.match(local, /includesR2Images:false/);
});
