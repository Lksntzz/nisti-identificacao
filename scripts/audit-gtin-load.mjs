import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidGtin13 } from '../src/gtin.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/gtin/product_gtins_v1.json'), 'utf8'));
const provenance = JSON.parse(fs.readFileSync(path.join(root, 'data/gtin/source_provenance_v1.json'), 'utf8'));
const d1Seed = fs.readFileSync(path.join(root, 'migrations/0016_product_gtins_seed_v1.sql'), 'utf8');
const supabaseSeed = fs.readFileSync(path.join(root, 'supabase/migrations/202609142010_nisti_gtin_gs1_seed_v1.sql'), 'utf8');
const records = manifest.records || [];

function fail(message) { throw new Error(`Auditoria GTIN falhou: ${message}`); }
function validSha256(value) { return /^[a-f0-9]{64}$/.test(String(value || '')); }

if (manifest.approved_count !== 220 || records.length !== 220) fail('a carga deve conter exatamente 220 vínculos');
if (new Set(records.map(row => row.product_id)).size !== 220) fail('product_id duplicado');
if (new Set(records.map(row => row.gtin)).size !== 220) fail('GTIN duplicado');
if (records.some(row => !isValidGtin13(row.gtin))) fail('há GTIN-13 com checksum inválido');
if (records.some(row => row.product_id === 84)) fail('Product ID 84 deve permanecer excluído');
if (!records.some(row => row.product_id === 19 && row.sku === 'VACMNO_MCP4_PAP' && row.gtin === '7898764981832')) fail('aprovação registrada do Product ID 19 não confere');

if (provenance.version !== manifest.version) fail('proveniência usa versão diferente do manifesto');
if (provenance.canonical_source_file !== 'reconciliacao_gs1_nisti_fechada.xlsx') fail('fonte canônica inesperada');
if (!validSha256(provenance.canonical_source_sha256)) fail('SHA-256 da fonte canônica ausente ou inválido');
if (provenance.reconciliation_workbook !== manifest.source_file) fail('manifesto não aponta para a planilha de reconciliação registrada');
if (!validSha256(provenance.reconciliation_workbook_sha256)) fail('SHA-256 da planilha de reconciliação ausente ou inválido');

for (const row of records) {
  const signature = `(${row.product_id}, '${row.gtin}', 'GTIN-13', 'GS1'`;
  if (!d1Seed.includes(signature)) fail(`D1 diverge no Product ID ${row.product_id}`);
  if (!supabaseSeed.includes(signature)) fail(`Supabase diverge no Product ID ${row.product_id}`);
}
const countRows = sql => [...sql.matchAll(/^\s*\(\d+, '\d{13}', 'GTIN-13', 'GS1',/gm)].length;
if (countRows(d1Seed) !== 220 || countRows(supabaseSeed) !== 220) fail('quantidade de linhas SQL diverge do manifesto');

console.log(JSON.stringify({
  ok: true,
  version: manifest.version,
  approved: records.length,
  unique_gtins: 220,
  unique_products: 220,
  excluded_product_id: 84,
  canonical_source_file: provenance.canonical_source_file,
  canonical_source_sha256: provenance.canonical_source_sha256,
  reconciliation_workbook: provenance.reconciliation_workbook,
  reconciliation_workbook_sha256: provenance.reconciliation_workbook_sha256
}, null, 2));
