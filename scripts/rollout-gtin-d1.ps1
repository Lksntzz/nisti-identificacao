param(
  [string]$Database = 'nisti-identificacao'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ExpectedWrangler = '3.114.17'
$ExpectedMigration = '0015_product_gtins.sql'
$ExpectedLinks = 220
$ExcludedProductId = 84
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$wrangler = Join-Path $root 'node_modules\.bin\wrangler.cmd'
$manifestPath = Join-Path $root 'data\gtin\product_gtins_v1.json'
$loadPath = Join-Path $root 'data\gtin\load_product_gtins_d1_v1.sql'

function Assert-LastExitCode([string]$Context) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Context falhou com exit code $LASTEXITCODE."
  }
}

function Invoke-D1Json([string]$Sql) {
  $raw = & $wrangler d1 execute $Database --remote --json --command $Sql
  Assert-LastExitCode 'wrangler d1 execute'
  $text = ($raw | Out-String).Trim()
  if (-not $text) { throw 'D1 retornou JSON vazio.' }
  $parsed = $text | ConvertFrom-Json
  $entry = if ($parsed -is [System.Array]) { $parsed[0] } else { $parsed }
  if ($null -eq $entry -or $null -eq $entry.results) {
    throw 'Formato JSON inesperado retornado pelo Wrangler D1.'
  }
  return @($entry.results)
}

if (-not (Test-Path $wrangler)) {
  throw "Wrangler local não encontrado em $wrangler. Execute npm install no clone correto."
}
if (-not (Test-Path $manifestPath)) { throw "Manifesto GTIN não encontrado: $manifestPath" }
if (-not (Test-Path $loadPath)) { throw "Carga GTIN D1 não encontrada: $loadPath" }

$versionOutput = (& $wrangler --version | Out-String).Trim()
Assert-LastExitCode 'wrangler --version'
if ($versionOutput -notmatch [regex]::Escape($ExpectedWrangler)) {
  throw "Wrangler inesperado. Esperado $ExpectedWrangler; recebido: $versionOutput"
}

$manifest = Get-Content -Raw -Encoding UTF8 $manifestPath | ConvertFrom-Json
$records = @($manifest.records)
if ($manifest.approved_count -ne $ExpectedLinks -or $records.Count -ne $ExpectedLinks) {
  throw "Manifesto GTIN inválido: esperado $ExpectedLinks vínculos aprovados."
}
if (@($records | Where-Object { [int]$_.product_id -eq $ExcludedProductId }).Count -ne 0) {
  throw "Manifesto inválido: Product ID $ExcludedProductId deve permanecer excluído."
}
$productIds = @($records | ForEach-Object { [int]$_.product_id } | Sort-Object -Unique)
if ($productIds.Count -ne $ExpectedLinks) { throw 'Manifesto contém product_id duplicado.' }
$idList = ($productIds -join ',')

Write-Host "Wrangler: $ExpectedWrangler"
Write-Host 'Inspecionando migrations D1 remotas...'
$migrationRaw = & $wrangler d1 migrations list $Database --remote
Assert-LastExitCode 'wrangler d1 migrations list'
$migrationText = ($migrationRaw | Out-String)
$pending = @(
  [regex]::Matches($migrationText, '\b\d{4}_[A-Za-z0-9_.-]+\.sql\b') |
    ForEach-Object { $_.Value } |
    Sort-Object -Unique
)

if ($pending.Count -gt 0) {
  if ($pending.Count -ne 1 -or $pending[0] -ne $ExpectedMigration) {
    throw "Gate abortado: migrations pendentes inesperadas: $($pending -join ', ')"
  }
  Write-Host "Aplicando somente $ExpectedMigration..."
  & $wrangler d1 migrations apply $Database --remote
  Assert-LastExitCode "aplicação de $ExpectedMigration"
} else {
  Write-Host 'Nenhuma migration pendente reportada; validando se o schema GTIN já existe.'
}

$schemaRows = Invoke-D1Json "SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type='table' AND name='product_gtins';"
if ([int]$schemaRows[0].table_count -ne 1) {
  throw 'Tabela product_gtins não existe após o gate de migration.'
}

$countRows = Invoke-D1Json 'SELECT COUNT(*) AS row_count FROM product_gtins;'
$currentCount = [int]$countRows[0].row_count
if ($currentCount -notin @(0, $ExpectedLinks)) {
  throw "product_gtins possui contagem inesperada antes da carga: $currentCount"
}

$catalogRows = Invoke-D1Json "SELECT COUNT(*) AS approved_product_ids_present FROM products WHERE id IN ($idList);"
$approvedPresent = [int]$catalogRows[0].approved_product_ids_present
if ($approvedPresent -ne $ExpectedLinks) {
  throw "Catálogo D1 incompleto para carga GTIN: $approvedPresent/$ExpectedLinks product_ids aprovados presentes."
}

if ($currentCount -eq 0) {
  Write-Host "Catálogo validado. Carregando exatamente $ExpectedLinks vínculos GTIN no D1..."
  & $wrangler d1 execute $Database --remote --file $loadPath
  Assert-LastExitCode 'carga operacional GTIN no D1'
} else {
  Write-Host 'Carga GTIN já possui 220 linhas; executando apenas validação idempotente.'
}

$validationSql = @"
SELECT
  COUNT(*) AS row_count,
  COUNT(DISTINCT gtin) AS unique_gtins,
  COUNT(DISTINCT product_id) AS unique_products,
  SUM(CASE WHEN product_id = 84 THEN 1 ELSE 0 END) AS excluded_84_rows,
  SUM(CASE WHEN product_id = 19 AND gtin = '7898764981832' THEN 1 ELSE 0 END) AS product_19_ok,
  SUM(CASE WHEN product_id = 208 AND gtin = '7898764983201' THEN 1 ELSE 0 END) AS product_208_ok
FROM product_gtins;
"@
$validationRows = Invoke-D1Json $validationSql
$v = $validationRows[0]
if ([int]$v.row_count -ne $ExpectedLinks -or
    [int]$v.unique_gtins -ne $ExpectedLinks -or
    [int]$v.unique_products -ne $ExpectedLinks -or
    [int]$v.excluded_84_rows -ne 0 -or
    [int]$v.product_19_ok -ne 1 -or
    [int]$v.product_208_ok -ne 1) {
  throw "Validação GTIN D1 falhou: $($v | ConvertTo-Json -Compress)"
}

$orphanRows = Invoke-D1Json 'SELECT COUNT(*) AS orphan_count FROM product_gtins g LEFT JOIN products p ON p.id=g.product_id WHERE p.id IS NULL;'
if ([int]$orphanRows[0].orphan_count -ne 0) { throw 'Validação GTIN D1 encontrou órfãos.' }

Write-Host ''
Write-Host 'GTIN D1 rollout concluído com sucesso.'
[pscustomobject]@{
  database = $Database
  migration = $ExpectedMigration
  product_gtins = [int]$v.row_count
  unique_gtins = [int]$v.unique_gtins
  unique_products = [int]$v.unique_products
  orphan_count = [int]$orphanRows[0].orphan_count
  excluded_product_id_84 = [int]$v.excluded_84_rows
  wrangler = $ExpectedWrangler
  deploy_performed = $false
} | ConvertTo-Json
