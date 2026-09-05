param(
  [string]$Database = 'nisti-identificacao',
  [string]$OutputRoot = 'migration-export'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-WranglerCapture {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  $stderrPath = Join-Path ([System.IO.Path]::GetTempPath()) ("nisti-wrangler-stderr-{0}.log" -f ([guid]::NewGuid().ToString('N')))
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Windows PowerShell 5.1 promotes native stderr records to NativeCommandError when
    # ErrorActionPreference=Stop. Wrangler 3.114.17 emits a benign out-of-date warning
    # on stderr, so capture stderr separately and decide success only from the exit code.
    $ErrorActionPreference = 'Continue'
    $output = & npx.cmd wrangler @Arguments 2> $stderrPath
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  $stderr = ''
  if (Test-Path $stderrPath) {
    $stderr = Get-Content -Path $stderrPath -Raw -ErrorAction SilentlyContinue
    Remove-Item -Path $stderrPath -Force -ErrorAction SilentlyContinue
  }

  if ($exitCode -ne 0) {
    $diagnostic = @($output) -join [Environment]::NewLine
    if ($stderr) {
      $diagnostic = (($diagnostic, $stderr.Trim()) | Where-Object { $_ }) -join [Environment]::NewLine
    }
    throw "Wrangler falhou ($exitCode):`n$diagnostic"
  }

  return $output
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$versionOutput = Invoke-WranglerCapture -Arguments @('--version')
$versionText = ($versionOutput -join ' ').Trim()
if ($versionText -notmatch '3\.114\.17') {
  throw "Wrangler inesperado: '$versionText'. A migração exige 3.114.17. Não prossiga com outra versão."
}

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$outDir = Join-Path $repoRoot (Join-Path $OutputRoot $stamp)
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$dataPath = Join-Path $outDir 'd1-data.sql'
$schemaPath = Join-Path $outDir 'd1-schema.sql'
$countsPath = Join-Path $outDir 'd1-counts.json'
$manifestPath = Join-Path $outDir 'manifest.json'

# Wrangler 3.114.17 is deliberately pinned for this project. Its `d1 export`
# command does not implement --skip-confirmation, and this pinned version performs
# remote exports without that prompt.
Write-Host "Exportando schema remoto de $Database..."
Invoke-WranglerCapture -Arguments @(
  'd1', 'export', $Database,
  '--remote',
  '--no-data',
  '--output', $schemaPath
) | Out-Null

Write-Host "Exportando dados remotos de $Database..."
Invoke-WranglerCapture -Arguments @(
  'd1', 'export', $Database,
  '--remote',
  '--no-schema',
  '--output', $dataPath
) | Out-Null

# Important: npx.cmd is a Windows batch shim. Passing a multiline value to
# --command can be truncated at the first newline by cmd.exe. Keep this SQL as a
# single physical line so all 13 authoritative table counts are returned.
$countSql = "SELECT 'products' AS table_name, COUNT(*) AS row_count FROM products UNION ALL SELECT 'product_platforms', COUNT(*) FROM product_platforms UNION ALL SELECT 'cover_embeddings', COUNT(*) FROM cover_embeddings UNION ALL SELECT 'recognition_daily', COUNT(*) FROM recognition_daily UNION ALL SELECT 'recognition_events', COUNT(*) FROM recognition_events UNION ALL SELECT 'cover_visual_references', COUNT(*) FROM cover_visual_references UNION ALL SELECT 'cover_reference_embeddings', COUNT(*) FROM cover_reference_embeddings UNION ALL SELECT 'cover_visual_signatures', COUNT(*) FROM cover_visual_signatures UNION ALL SELECT 'notifications', COUNT(*) FROM notifications UNION ALL SELECT 'notification_reads', COUNT(*) FROM notification_reads UNION ALL SELECT 'push_subscriptions', COUNT(*) FROM push_subscriptions UNION ALL SELECT 'scan_occurrences', COUNT(*) FROM scan_occurrences UNION ALL SELECT 'geometric_shadow_evidence', COUNT(*) FROM geometric_shadow_evidence ORDER BY table_name;"

Write-Host 'Capturando contagens de origem...'
$countOutput = Invoke-WranglerCapture -Arguments @(
  'd1', 'execute', $Database,
  '--remote',
  '--json',
  '--command', $countSql
)
$countJson = @($countOutput) -join [Environment]::NewLine
try {
  $parsedCounts = $countJson | ConvertFrom-Json
}
catch {
  throw "Wrangler retornou JSON de contagens inválido: $($_.Exception.Message)"
}

if (-not $parsedCounts.success) {
  throw 'Consulta remota de contagens D1 não retornou success=true.'
}
if (-not $parsedCounts.results -or @($parsedCounts.results).Count -ne 13) {
  $actual = if ($parsedCounts.results) { @($parsedCounts.results).Count } else { 0 }
  throw "Consulta remota de contagens retornou $actual tabela(s); esperado: 13. Snapshot abortado."
}
$countJson | Set-Content -Path $countsPath -Encoding utf8

if (-not (Test-Path $dataPath) -or (Get-Item $dataPath).Length -le 0) {
  throw 'Export de dados vazio ou ausente.'
}
if (-not (Test-Path $schemaPath) -or (Get-Item $schemaPath).Length -le 0) {
  throw 'Export de schema vazio ou ausente.'
}

$dataHash = (Get-FileHash -Algorithm SHA256 -Path $dataPath).Hash.ToLowerInvariant()
$schemaHash = (Get-FileHash -Algorithm SHA256 -Path $schemaPath).Hash.ToLowerInvariant()

$manifest = [ordered]@{
  database = $Database
  exported_at_utc = (Get-Date).ToUniversalTime().ToString('o')
  wrangler = $versionText
  source = 'cloudflare_d1_remote'
  files = [ordered]@{
    data = [ordered]@{
      name = 'd1-data.sql'
      bytes = (Get-Item $dataPath).Length
      sha256 = $dataHash
    }
    schema = [ordered]@{
      name = 'd1-schema.sql'
      bytes = (Get-Item $schemaPath).Length
      sha256 = $schemaHash
    }
    counts = [ordered]@{
      name = 'd1-counts.json'
      bytes = (Get-Item $countsPath).Length
    }
  }
}

$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $manifestPath -Encoding utf8

Write-Host ''
Write-Host 'Snapshot D1 concluído sem alteração de dados.'
Write-Host "Diretório: $outDir"
Write-Host "Dados SHA256:  $dataHash"
Write-Host "Schema SHA256: $schemaHash"
Write-Host ''
Write-Host 'Não execute cutover. Preserve este diretório e use-o apenas para a importação/validação no Supabase.'
