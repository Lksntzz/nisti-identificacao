import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  TABLE_ORDER,
  insertTableName,
  splitSqlStatements
} from './convert-d1-export-for-supabase.mjs';

export const STAGE_SCHEMA = 'nisti_cutover_stage_20261001';

const PRIMARY_KEYS = Object.freeze({
  products: ['id'],
  product_platforms: ['id'],
  product_gtins: ['id'],
  cover_embeddings: ['capa_code'],
  recognition_daily: ['day'],
  recognition_events: ['id'],
  cover_visual_references: ['id'],
  cover_reference_embeddings: ['reference_id'],
  cover_visual_signatures: ['capa_code'],
  notifications: ['id'],
  notification_reads: ['id'],
  push_subscriptions: ['id'],
  scan_occurrences: ['id'],
  scan_occurrence_candidates: ['occurrence_id', 'capa_code'],
  scan_occurrence_review_sessions: ['occurrence_id'],
  geometric_shadow_evidence: ['id'],
  gtin_scan_events: ['id'],
  mural_product_images: ['product_id'],
  mural_collections: ['id'],
  mural_collection_products: ['collection_id', 'product_id'],
  mural_posts: ['id'],
  mural_post_reads: ['post_id', 'user_id']
});

const IDENTITY_TABLES = Object.freeze([
  'products',
  'product_platforms',
  'product_gtins',
  'recognition_events',
  'cover_visual_references',
  'notifications',
  'notification_reads',
  'push_subscriptions',
  'scan_occurrences',
  'geometric_shadow_evidence',
  'mural_collections',
  'mural_posts'
]);

const PRODUCT_UPDATE_COLUMNS = Object.freeze([
  'sku', 'miolo_code', 'capa_code', 'acabamento_code', 'wireo_code',
  'tassel_code', 'elastico_code', 'nome', 'variacao', 'image_key',
  'created_at', 'updated_at'
]);

function stripLeadingComments(statement) {
  let value = String(statement || '').trim();
  while (value.startsWith('--') || value.startsWith('/*')) {
    if (value.startsWith('--')) {
      const newline = value.indexOf('\n');
      value = newline >= 0 ? value.slice(newline + 1).trimStart() : '';
    } else {
      const end = value.indexOf('*/', 2);
      if (end < 0) break;
      value = value.slice(end + 2).trimStart();
    }
  }
  return value;
}

function stageInsert(statement, table) {
  const value = stripLeadingComments(statement);
  return value.replace(
    /^(INSERT\s+INTO\s+)(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)/i,
    `$1${STAGE_SCHEMA}."${table}"`
  );
}

function sequenceSyncSql(table) {
  return `SELECT setval(pg_get_serial_sequence('public.${table}', 'id'), COALESCE((SELECT MAX(id) FROM public.${table}), 1), EXISTS (SELECT 1 FROM public.${table}));`;
}

function writeChunks(dir, grouped, maxBytes) {
  const manifest = [];
  let index = 1;
  for (const table of TABLE_ORDER) {
    let statements = [];
    let bytes = 0;
    const flush = () => {
      if (!statements.length) return;
      const name = `${String(index).padStart(4, '0')}-${table}.sql`;
      const sql = `BEGIN;\n${statements.join('\n')}\nCOMMIT;\n`;
      fs.writeFileSync(path.join(dir, name), sql, 'utf8');
      manifest.push({ file: name, table, statements: statements.length, bytes: Buffer.byteLength(sql) });
      statements = [];
      bytes = 0;
      index += 1;
    };

    for (const statement of grouped.get(table)) {
      const staged = stageInsert(statement, table);
      const statementBytes = Buffer.byteLength(staged) + 1;
      if (statements.length && bytes + statementBytes > maxBytes) flush();
      statements.push(staged);
      bytes += statementBytes;
    }
    flush();
  }
  return manifest;
}

export function buildStagedReconcile(inputPath, outputDir, maxBytes = 90_000) {
  const source = fs.readFileSync(path.resolve(inputPath), 'utf8').replace(/^\uFEFF/, '');
  const grouped = new Map(TABLE_ORDER.map(table => [table, []]));
  for (const statement of splitSqlStatements(source)) {
    const table = insertTableName(statement);
    if (table && grouped.has(table)) grouped.get(table).push(statement);
  }

  const targetDir = path.resolve(outputDir);
  fs.mkdirSync(targetDir, { recursive: true });
  const counts = Object.fromEntries(TABLE_ORDER.map(table => [table, grouped.get(table).length]));

  const init = [
    `CREATE SCHEMA ${STAGE_SCHEMA};`,
    `REVOKE ALL ON SCHEMA ${STAGE_SCHEMA} FROM PUBLIC, anon, authenticated;`,
    ...TABLE_ORDER.map(table =>
      `CREATE TABLE ${STAGE_SCHEMA}."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY);`
    ),
    ''
  ].join('\n');
  fs.writeFileSync(path.join(targetDir, '0000-init.sql'), init, 'utf8');

  const chunks = writeChunks(targetDir, grouped, maxBytes);
  const replaceTables = TABLE_ORDER.filter(table => table !== 'products');
  const expectedChecks = TABLE_ORDER.map(table =>
    `  IF (SELECT COUNT(*) FROM ${STAGE_SCHEMA}."${table}") <> ${counts[table]} THEN RAISE EXCEPTION 'stage_count_mismatch:${table}'; END IF;`
  );
  const finalChecks = TABLE_ORDER.map(table =>
    `  IF (SELECT COUNT(*) FROM public."${table}") <> ${counts[table]} THEN RAISE EXCEPTION 'final_count_mismatch:${table}'; END IF;`
  );

  const finalize = [
    'BEGIN;',
    "SET LOCAL statement_timeout = '5min';",
    'DO $validate$',
    'BEGIN',
    ...expectedChecks,
    `  IF EXISTS (SELECT id FROM public.products EXCEPT SELECT id FROM ${STAGE_SCHEMA}.products) THEN`,
    "    RAISE EXCEPTION 'cutover_products_not_in_snapshot';",
    '  END IF;',
    'END',
    '$validate$;',
    'TRUNCATE TABLE',
    replaceTables.map(table => `  public."${table}"`).join(',\n'),
    'RESTART IDENTITY;',
    'INSERT INTO public.products',
    `SELECT * FROM ${STAGE_SCHEMA}.products`,
    'ON CONFLICT (id) DO UPDATE SET',
    PRODUCT_UPDATE_COLUMNS.map(column => `  "${column}" = EXCLUDED."${column}"`).join(',\n') + ';',
    ...replaceTables.map(table =>
      `INSERT INTO public."${table}" SELECT * FROM ${STAGE_SCHEMA}."${table}";`
    ),
    ...IDENTITY_TABLES.map(sequenceSyncSql),
    'DO $validate$',
    'BEGIN',
    ...finalChecks,
    'END',
    '$validate$;',
    'COMMIT;',
    TABLE_ORDER.map(table =>
      `SELECT '${table}' AS table_name, COUNT(*)::bigint AS row_count FROM public."${table}"`
    ).join('\nUNION ALL\n') + '\nORDER BY table_name;',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(targetDir, '9999-finalize.sql'), finalize, 'utf8');
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), `${JSON.stringify({ schema: STAGE_SCHEMA, counts, chunks }, null, 2)}\n`, 'utf8');
  return { targetDir, counts, chunks };
}

function main() {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) {
    console.error('Uso: node scripts/build-supabase-staged-reconcile.mjs <postgres-data.sql> <diretório-saída>');
    process.exitCode = 2;
    return;
  }
  const result = buildStagedReconcile(input, output);
  console.log(`Staging: ${result.targetDir}`);
  console.log(`Chunks:  ${result.chunks.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
