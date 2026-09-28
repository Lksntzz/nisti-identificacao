import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  TABLE_ORDER,
  insertTableName,
  splitSqlStatements
} from './convert-d1-export-for-supabase.mjs';

const ALLOWED_TABLES = new Set(TABLE_ORDER);
const IDENTITY_TABLES = Object.freeze([
  'products',
  'product_platforms',
  'recognition_events',
  'cover_visual_references',
  'notifications',
  'notification_reads',
  'push_subscriptions',
  'scan_occurrences',
  'geometric_shadow_evidence'
]);

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function stripLeadingComments(statement) {
  let value = String(statement || '').trim();
  while (value) {
    if (value.startsWith('--')) {
      const newline = value.indexOf('\n');
      value = newline >= 0 ? value.slice(newline + 1).trimStart() : '';
      continue;
    }
    if (value.startsWith('/*')) {
      const end = value.indexOf('*/', 2);
      if (end < 0) return value;
      value = value.slice(end + 2).trimStart();
      continue;
    }
    break;
  }
  return value;
}

function normalizeControl(statement) {
  return stripLeadingComments(statement).replace(/;\s*$/, '').trim();
}

function sequenceSyncSql(table) {
  return `SELECT setval(\n  pg_get_serial_sequence('public.${table}', 'id'),\n  COALESCE((SELECT MAX(id) FROM public.${table}), 1),\n  EXISTS (SELECT 1 FROM public.${table})\n);`;
}

export function buildFinalReplaceSql(source) {
  const grouped = new Map(TABLE_ORDER.map(table => [table, []]));
  let beginCount = 0;
  let commitCount = 0;
  let timeoutCount = 0;

  for (const statement of splitSqlStatements(source)) {
    const table = insertTableName(statement);
    if (table) {
      if (!ALLOWED_TABLES.has(table)) {
        throw new Error(`postgres-data.sql contém tabela não autoritativa: ${table}`);
      }
      const value = stripLeadingComments(statement);
      grouped.get(table).push(value.endsWith(';') ? value : `${value};`);
      continue;
    }

    const control = normalizeControl(statement);
    if (!control) continue;
    if (/^BEGIN$/i.test(control)) {
      beginCount += 1;
      continue;
    }
    if (/^COMMIT$/i.test(control)) {
      commitCount += 1;
      continue;
    }
    if (/^SET\s+LOCAL\s+statement_timeout\s*=\s*'5min'$/i.test(control)) {
      timeoutCount += 1;
      continue;
    }
    throw new Error(`postgres-data.sql contém instrução inesperada: ${control.slice(0, 80)}`);
  }

  if (beginCount !== 1 || commitCount !== 1 || timeoutCount !== 1) {
    throw new Error(
      `Estrutura transacional inesperada em postgres-data.sql (BEGIN=${beginCount}, COMMIT=${commitCount}, timeout=${timeoutCount}).`
    );
  }

  const statementCounts = Object.fromEntries(
    TABLE_ORDER.map(table => [table, grouped.get(table).length])
  );

  const quotedTables = TABLE_ORDER.map(table => `public."${table}"`).join(',\n  ');
  const sections = [
    '-- NISTI ID — FINAL CUTOVER REPLACE',
    '-- DESTRUTIVO: substitui atomicamente as 13 tabelas autoritativas do Supabase.',
    '-- Pré-condição obrigatória: SUPABASE_CUTOVER_WRITE_FREEZE=1 em produção e confirmado.',
    '-- Não executa CASCADE: qualquer dependência relacional inesperada aborta em vez de apagar dados silenciosamente.',
    'BEGIN;',
    "SET LOCAL statement_timeout = '5min';",
    'SET LOCAL search_path = public, pg_catalog;',
    '',
    'TRUNCATE TABLE',
    `  ${quotedTables}`,
    'RESTART IDENTITY;',
    ''
  ];

  for (const table of TABLE_ORDER) {
    sections.push(`-- ${table}: ${grouped.get(table).length} statement(s)`);
    sections.push(...grouped.get(table));
    sections.push('');
  }

  sections.push('-- Sincroniza as sequences das colunas IDENTITY com os IDs D1 preservados.');
  for (const table of IDENTITY_TABLES) {
    sections.push(sequenceSyncSql(table), '');
  }

  sections.push('COMMIT;', '');
  return {
    sql: sections.join('\n'),
    statementCounts
  };
}

export function buildFinalReplaceFile(inputPath) {
  const sourcePath = path.resolve(inputPath);
  if (!fs.existsSync(sourcePath)) throw new Error(`Arquivo não encontrado: ${sourcePath}`);
  if (path.basename(sourcePath).toLowerCase() !== 'postgres-data.sql') {
    throw new Error('Entrada deve ser exatamente o postgres-data.sql gerado pelo conversor NISTI.');
  }

  const source = fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '');
  if (!source.trim()) throw new Error('postgres-data.sql vazio.');

  const built = buildFinalReplaceSql(source);
  const dir = path.dirname(sourcePath);
  const outputPath = path.join(dir, 'postgres-final-replace.sql');
  const reportPath = path.join(dir, 'final-replace-report.json');

  fs.writeFileSync(outputPath, built.sql, 'utf8');
  const report = {
    source_file: path.basename(sourcePath),
    source_bytes: Buffer.byteLength(source),
    source_sha256: sha256(source),
    output_file: path.basename(outputPath),
    output_bytes: Buffer.byteLength(built.sql),
    output_sha256: sha256(built.sql),
    statement_counts: built.statementCounts,
    table_order: TABLE_ORDER,
    destructive_replace: true,
    requires_cutover_write_freeze: true,
    cascade: false
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { outputPath, reportPath, report };
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Uso: node scripts/build-supabase-final-replace.mjs <migration-export/.../postgres-data.sql>');
    process.exitCode = 2;
    return;
  }

  try {
    const { outputPath, reportPath, report } = buildFinalReplaceFile(inputPath);
    console.log(`Replace SQL: ${outputPath}`);
    console.log(`Relatório:   ${reportPath}`);
    console.log(`SHA256:      ${report.output_sha256}`);
    console.log('ATENÇÃO: execute somente durante SUPABASE_CUTOVER_WRITE_FREEZE=1 confirmado.');
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
