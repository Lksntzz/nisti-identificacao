import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const exportScriptPath = 'scripts/export-d1-for-supabase.ps1';
const runbookPath = 'supabase/MIGRATION_PHASE2.md';
const afterImportPath = 'supabase/sql/after_d1_import.sql';
const validatePath = 'supabase/sql/validate_d1_import.sql';

test('phase 2 keeps D1 snapshot export read-only and pinned', () => {
  const source = fs.readFileSync(exportScriptPath, 'utf8');
  assert.match(source, /^param\(/);
  assert.match(source, /3\\\.114\\\.17/);
  assert.match(source, /'d1', 'export'/);
  assert.match(source, /'--remote'/);
  assert.match(source, /'--no-data'/);
  assert.match(source, /'--no-schema'/);
  assert.match(source, /\$authoritativeTables = @\(/);
  assert.match(source, /foreach \(\$table in \$authoritativeTables\)/);
  assert.match(source, /SELECT COUNT\(\*\) AS row_count FROM/);
  assert.match(source, /\$countRecords\.Count -ne 13/);
  assert.doesNotMatch(source, /d1', 'migrations', 'apply/i);
  assert.doesNotMatch(source, /d1', 'execute'.*--file/s);
  assert.doesNotMatch(source, /wrangler deploy/i);
});

test('phase 2 runbook forbids cutover before parity', () => {
  const source = fs.readFileSync(runbookPath, 'utf8');
  assert.match(source, /Não executar cutover antes da validação de paridade/);
  assert.match(source, /Wrangler deve permanecer exatamente em `3\.114\.17`/);
  assert.match(source, /D1 permanecerá disponível como rollback/);
});

test('post-import SQL only synchronizes identity sequences', () => {
  const source = fs.readFileSync(afterImportPath, 'utf8');
  assert.match(source, /pg_get_serial_sequence\('public\.products', 'id'\)/);
  assert.match(source, /pg_get_serial_sequence\('public\.geometric_shadow_evidence', 'id'\)/);
  assert.doesNotMatch(source, /\bINSERT\b/i);
  assert.doesNotMatch(source, /\bDELETE\b/i);
  assert.doesNotMatch(source, /\bUPDATE\b/i);
});

test('validation SQL covers all 13 migrated tables and integrity checks', () => {
  const source = fs.readFileSync(validatePath, 'utf8');
  const tables = [
    'products', 'product_platforms', 'cover_embeddings', 'recognition_daily',
    'recognition_events', 'cover_visual_references', 'cover_reference_embeddings',
    'cover_visual_signatures', 'notifications', 'notification_reads',
    'push_subscriptions', 'scan_occurrences', 'geometric_shadow_evidence'
  ];
  for (const table of tables) assert.match(source, new RegExp(`public\\.${table}`));
  assert.match(source, /REFERENTIAL_INTEGRITY/);
  assert.match(source, /BUSINESS_INVARIANTS/);
  assert.match(source, /PLATFORM_DOMAIN/);
  assert.match(source, /ID_RANGES/);
});

test('PowerShell parser accepts export script when pwsh is available', (t) => {
  const probe = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT') {
    t.skip('pwsh unavailable in this environment');
    return;
  }
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  const escaped = exportScriptPath.replaceAll("'", "''");
  const command = `$errorsRef = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$null, [ref]$errorsRef); if ($errorsRef.Count -gt 0) { $errorsRef | ForEach-Object { Write-Error $_.Message }; exit 1 }`;
  const parsed = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', command], { encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);
});
