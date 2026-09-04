import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const TABLE_ORDER = Object.freeze([
  'products',
  'product_platforms',
  'cover_embeddings',
  'recognition_daily',
  'recognition_events',
  'cover_visual_references',
  'cover_reference_embeddings',
  'cover_visual_signatures',
  'notifications',
  'notification_reads',
  'push_subscriptions',
  'scan_occurrences',
  'geometric_shadow_evidence'
]);

const ALLOWED_TABLES = new Set(TABLE_ORDER);
const IGNORED_EPHEMERAL_TABLES = new Set([
  'sqlite_sequence',
  'd1_migrations',
  'gemini_call_budget'
]);

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function splitSqlStatements(source) {
  const text = String(source || '');
  const statements = [];
  let start = 0;
  let single = false;
  let double = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (single) {
      if (ch === "'" && next === "'") {
        i += 1;
        continue;
      }
      if (ch === "'") single = false;
      continue;
    }
    if (double) {
      if (ch === '"' && next === '"') {
        i += 1;
        continue;
      }
      if (ch === '"') double = false;
      continue;
    }

    if (ch === '-' && next === '-') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'") {
      single = true;
      continue;
    }
    if (ch === '"') {
      double = true;
      continue;
    }
    if (ch === ';') {
      const statement = text.slice(start, i + 1).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
  }

  const tail = text.slice(start).trim();
  if (tail) statements.push(tail);

  if (single || double || blockComment) {
    throw new Error('Export SQL termina dentro de string/identificador/comentário; snapshot pode estar truncado.');
  }

  return statements;
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

export function insertTableName(statement) {
  const value = stripLeadingComments(statement);
  const match = value.match(/^INSERT\s+INTO\s+(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_]*))\b/i);
  if (!match) return null;
  return String(match[1] || match[2] || '').replace(/""/g, '"').toLowerCase();
}

function classifyNonInsert(statement) {
  const value = stripLeadingComments(statement).replace(/;\s*$/, '').trim();
  if (!value) return 'empty';
  if (/^(?:BEGIN(?:\s+TRANSACTION)?|COMMIT|END|PRAGMA\b)/i.test(value)) return 'control';
  return 'unsupported';
}

export function convertD1DataSql(source) {
  const grouped = new Map(TABLE_ORDER.map(table => [table, []]));
  const ignored = {};
  const unsupported = [];

  for (const statement of splitSqlStatements(source)) {
    const value = stripLeadingComments(statement);
    if (!value) continue;

    if (/^INSERT\s+OR\s+(?:REPLACE|IGNORE)\b/i.test(value) || /^REPLACE\s+INTO\b/i.test(value)) {
      unsupported.push(value.slice(0, 180));
      continue;
    }

    const table = insertTableName(value);
    if (table) {
      if (ALLOWED_TABLES.has(table)) {
        if (/\bX'[0-9A-F]*'/i.test(value)) {
          unsupported.push(`SQLite blob literal em ${table}: ${value.slice(0, 140)}`);
          continue;
        }
        grouped.get(table).push(value.endsWith(';') ? value : `${value};`);
        continue;
      }
      if (IGNORED_EPHEMERAL_TABLES.has(table) || table.startsWith('_cf_')) {
        ignored[table] = (ignored[table] || 0) + 1;
        continue;
      }
      unsupported.push(`Tabela não mapeada ${table}: ${value.slice(0, 140)}`);
      continue;
    }

    const classification = classifyNonInsert(value);
    if (classification !== 'control' && classification !== 'empty') {
      unsupported.push(value.slice(0, 180));
    }
  }

  if (unsupported.length) {
    const sample = unsupported.slice(0, 5).join('\n---\n');
    throw new Error(
      `Export contém ${unsupported.length} instrução(ões) não convertidas. Migração abortada para evitar perda silenciosa.\n${sample}`
    );
  }

  const statementCounts = Object.fromEntries(
    TABLE_ORDER.map(table => [table, grouped.get(table).length])
  );

  const sections = [
    '-- NISTI ID — dados convertidos do snapshot D1 para PostgreSQL',
    '-- Gerado de forma fail-closed; IDs explícitos são preservados.',
    'BEGIN;',
    "SET LOCAL statement_timeout = '5min';"
  ];

  for (const table of TABLE_ORDER) {
    const statements = grouped.get(table);
    sections.push('', `-- ${table}: ${statements.length} statement(s)`);
    sections.push(...statements);
  }

  sections.push('', 'COMMIT;', '');
  return {
    sql: sections.join('\n'),
    statementCounts,
    ignored
  };
}

export function convertFile(inputPath) {
  const sourcePath = path.resolve(inputPath);
  if (!fs.existsSync(sourcePath)) throw new Error(`Arquivo não encontrado: ${sourcePath}`);

  const source = fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, '');
  if (!source.trim()) throw new Error('Export D1 vazio.');

  const converted = convertD1DataSql(source);
  const dir = path.dirname(sourcePath);
  const outputPath = path.join(dir, 'postgres-data.sql');
  const reportPath = path.join(dir, 'conversion-report.json');

  fs.writeFileSync(outputPath, converted.sql, 'utf8');
  const report = {
    source_file: path.basename(sourcePath),
    source_bytes: Buffer.byteLength(source),
    source_sha256: sha256(source),
    output_file: path.basename(outputPath),
    output_bytes: Buffer.byteLength(converted.sql),
    output_sha256: sha256(converted.sql),
    statement_counts: converted.statementCounts,
    ignored_ephemeral_statements: converted.ignored,
    table_order: TABLE_ORDER
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return { outputPath, reportPath, report };
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('Uso: node scripts/convert-d1-export-for-supabase.mjs <migration-export/.../d1-data.sql>');
    process.exitCode = 2;
    return;
  }

  try {
    const { outputPath, reportPath, report } = convertFile(inputPath);
    console.log(`PostgreSQL: ${outputPath}`);
    console.log(`Relatório:  ${reportPath}`);
    console.log(`SHA256:     ${report.output_sha256}`);
  } catch (error) {
    console.error(error?.message || error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
