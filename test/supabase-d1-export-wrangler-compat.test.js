import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scriptUrl = new URL('../scripts/export-d1-for-supabase.ps1', import.meta.url);

test('D1 export script remains compatible with pinned Wrangler 3.114.17', async () => {
  const script = await readFile(scriptUrl, 'utf8');

  assert.match(script, /3\\\.114\\\.17/);
  assert.match(script, /'d1', 'export', \$Database/);
  assert.match(script, /'--remote'/);
  assert.match(script, /'--no-data'/);
  assert.match(script, /'--no-schema'/);
  assert.doesNotMatch(script, /'--skip-confirmation'/);
});

test('D1 export script does not let harmless native stderr warnings abort Windows PowerShell', async () => {
  const script = await readFile(scriptUrl, 'utf8');

  assert.match(script, /\$previousErrorActionPreference = \$ErrorActionPreference/);
  assert.match(script, /\$ErrorActionPreference = 'Continue'/);
  assert.match(script, /2> \$stderrPath/);
  assert.match(script, /\$exitCode = \$LASTEXITCODE/);
  assert.match(script, /if \(\$exitCode -ne 0\)/);
  assert.doesNotMatch(script, /2>&1/);
});

test('D1 count JSON is sourced from stdout only, not Wrangler warnings', async () => {
  const script = await readFile(scriptUrl, 'utf8');

  assert.match(script, /\$countOutput = Invoke-WranglerCapture/);
  assert.match(script, /\$countJson \| Set-Content -Path \$countsPath -Encoding utf8/);
  assert.match(script, /Get-Content -Path \$stderrPath -Raw/);
});

test('D1 counts query all 13 authoritative tables independently without compound SELECT', async () => {
  const script = await readFile(scriptUrl, 'utf8');
  const expectedTables = [
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
  ];

  for (const table of expectedTables) {
    assert.match(script, new RegExp(`'${table}'`));
  }

  assert.match(script, /foreach \(\$table in \$authoritativeTables\)/);
  assert.match(script, /SELECT COUNT\(\*\) AS row_count FROM/);
  assert.match(script, /\$countRecords\.Count -ne 13/);
  assert.doesNotMatch(script, /UNION ALL/);
});
