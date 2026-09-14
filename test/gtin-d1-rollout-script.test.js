import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const scriptPath = 'scripts/rollout-gtin-d1.ps1';

test('GTIN D1 rollout is fail-closed and cannot deploy the Worker', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  assert.match(source, /3\.114\.17/);
  assert.match(source, /0015_product_gtins\.sql/);
  assert.match(source, /load_product_gtins_d1_v1\.sql/);
  assert.match(source, /approved_count/);
  assert.match(source, /Product ID \$ExcludedProductId deve permanecer excluído/);
  assert.match(source, /COUNT\(DISTINCT gtin\)/);
  assert.match(source, /COUNT\(DISTINCT product_id\)/);
  assert.match(source, /orphan_count/);
  assert.match(source, /product_id = 19 AND gtin = '7898764981832'/);
  assert.match(source, /product_id = 208 AND gtin = '7898764983201'/);
  assert.match(source, /deploy_performed = \$false/);
  assert.doesNotMatch(source, /&\s*\$wrangler\s+deploy\b/i);
  assert.doesNotMatch(source, /\bwrangler(?:\.cmd)?\s+deploy\b/i);
  assert.doesNotMatch(source, /SUPABASE_READS_ENABLED\s*=/i);
  assert.doesNotMatch(source, /RETRIEVAL_FASTPATH_MIN_/i);
});

test('GTIN D1 rollout PowerShell parses when pwsh is available', (t) => {
  const probe = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
  if (probe.error?.code === 'ENOENT' || probe.status !== 0) {
    t.skip('pwsh unavailable or unhealthy in this environment');
    return;
  }
  const escaped = scriptPath.replaceAll("'", "''");
  const command = `$errorsRef = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${escaped}', [ref]$null, [ref]$errorsRef); if ($errorsRef.Count -gt 0) { $errorsRef | ForEach-Object { Write-Error $_.Message }; exit 1 }`;
  const parsed = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', command], { encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr || parsed.stdout);
});
