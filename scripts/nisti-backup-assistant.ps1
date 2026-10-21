# NISTI: assistente manual de backup criptografado, executado SOMENTE no Windows local.
# Nunca envia senhas ou banco para GitHub, GitHub Actions ou ChatGPT.
# O arquivo .dump permanece temporariamente fora do destino e e apagado pelo script Node.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$locationChanged = $false
$exitCode = 0

try {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

  foreach ($program in @('node', 'psql', 'pg_dump', 'pg_restore')) {
    if (-not (Get-Command -Name $program -ErrorAction SilentlyContinue)) {
      throw "Programa '$program' nao encontrado. Instale Node.js e o cliente PostgreSQL 17."
    }
  }

  Write-Host ''
  Write-Host '=== Backup seguro do NISTI (Supabase) ===' -ForegroundColor Cyan
  Write-Host 'Os dados serao exportados SOMENTE apos sua confirmacao.'
  Write-Host 'A copia sera criptografada antes de entrar na pasta escolhida.'
  Write-Host 'Este procedimento NAO inclui imagens do Cloudflare R2.'
  Write-Host 'Nunca envie senhas por chat nem as grave no GitHub.'
  Write-Host ''

  $dbHost = (Read-Host 'Host PostgreSQL no Supabase > Connect (sem protocolo)').Trim()
  $dbUser = (Read-Host 'Usuario PostgreSQL no Supabase > Connect').Trim()
  $portText = (Read-Host 'Porta da conexao [5432]').Trim()
  if ([string]::IsNullOrWhiteSpace($portText)) { $portText = '5432' }
  [int]$dbPort = 0
  if (-not [int]::TryParse($portText, [ref]$dbPort) -or $dbPort -lt 1 -or $dbPort -gt 65535) {
    throw 'Porta invalida. Use a porta mostrada em Supabase > Connect.'
  }
  if ([string]::IsNullOrWhiteSpace($dbHost) -or [string]::IsNullOrWhiteSpace($dbUser)) {
    throw 'Informe o host e o usuario da conexao do Supabase.'
  }
  if ($dbHost.Contains('://') -or $dbHost.Contains('@') -or $dbHost.Contains('/')) {
    throw 'Digite apenas o host do PostgreSQL, nao uma URL com senha.'
  }

  $defaultDir = Join-Path $env:USERPROFILE 'NISTI-Criptografado'
  $answer = Read-Host "Pasta PRIVADA de destino (Enter = $defaultDir)"
  if ([string]::IsNullOrWhiteSpace($answer)) {
    $destination = $defaultDir
  } else {
    $destination = $answer.Trim().Trim('"')
  }
  if (-not [System.IO.Path]::IsPathRooted($destination)) {
    throw 'O destino deve ser um caminho ABSOLUTO, fora do repositorio do NISTI.'
  }

  $targetFull = [System.IO.Path]::GetFullPath($destination).TrimEnd('\', '/')
  $baseFull = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd('\', '/')
  if ($targetFull.Equals($baseFull, [StringComparison]::OrdinalIgnoreCase) -or
      $targetFull.StartsWith($baseFull + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Nao salve backups dentro da pasta do projeto/GitHub.'
  }
  if (-not (Test-Path -LiteralPath $destination)) {
    if (-not $destination.Equals($defaultDir, [StringComparison]::OrdinalIgnoreCase)) {
      throw 'A pasta escolhida nao existe. Abra a pasta REAL do Drive e informe o caminho correto.'
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
  }
  if (-not (Test-Path -LiteralPath $destination -PathType Container)) {
    throw 'A pasta de destino nao esta disponivel.'
  }

  $dbPasswordSecure = Read-Host 'Senha do PostgreSQL (oculta)' -AsSecureString
  $backupPasswordSecure = Read-Host 'Senha EXCLUSIVA do backup (20+ caracteres, oculta)' -AsSecureString
  $dbPassword = [System.Net.NetworkCredential]::new('', $dbPasswordSecure).Password
  $backupPassword = [System.Net.NetworkCredential]::new('', $backupPasswordSecure).Password
  if ([string]::IsNullOrWhiteSpace($dbPassword)) {
    throw 'A senha do banco esta vazia.'
  }
  if ($backupPassword.Length -lt 20 -or $backupPassword -eq $dbPassword) {
    throw 'Use uma senha de backup diferente da senha do banco, com 20+ caracteres.'
  }

  $env:PGHOST = $dbHost
  $env:PGPORT = [string]$dbPort
  $env:PGUSER = $dbUser
  $env:PGDATABASE = 'postgres'
  $env:PGSSLMODE = 'require'
  $env:PGPASSWORD = $dbPassword
  $env:NISTI_BACKUP_PASSPHRASE = $backupPassword
  $env:NISTI_BACKUP_MAX_MB = '100'
  $dbPassword = $null
  $backupPassword = $null

  Push-Location $repoRoot
  $locationChanged = $true
  Write-Host ''
  Write-Host 'Consultando apenas o tamanho do banco...'
  & node 'scripts/nisti-free-backup.mjs' status
  if ($LASTEXITCODE -ne 0) { throw 'A consulta de tamanho falhou. Nenhuma copia foi iniciada.' }

  $confirmed = Read-Host 'Para gerar a copia criptografada, digite BACKUP'
  if ($confirmed -cne 'BACKUP') {
    Write-Host 'Cancelado. Nenhuma exportacao realizada.'
  } else {
    $before = @(Get-ChildItem -LiteralPath $destination -File -Filter '*.nisti.enc' |
      ForEach-Object { $_.FullName })
    & node 'scripts/nisti-drive-backup.mjs' backup --output-dir $destination
    if ($LASTEXITCODE -ne 0) { throw 'Falha na exportacao criptografada.' }

    $created = @(Get-ChildItem -LiteralPath $destination -File -Filter '*.nisti.enc' |
      Where-Object { $before -notcontains $_.FullName })
    if ($created.Count -ne 1) {
      throw 'Nao foi possivel identificar exatamente um arquivo novo para validar.'
    }

    $encryptedFile = $created[0].FullName
    $manifestFile = $encryptedFile -replace '\.nisti\.enc$', '.nisti.json'
    if (-not (Test-Path -LiteralPath $manifestFile -PathType Leaf)) {
      throw 'Manifesto de integridade nao encontrado.'
    }

    Write-Host 'Validando criptografia e verificando estrutura do arquivo...'
    & node 'scripts/nisti-drive-backup.mjs' verify --file $encryptedFile
    if ($LASTEXITCODE -ne 0) { throw 'Falhou a verificacao da criptografia.' }
    & node 'scripts/nisti-drive-backup.mjs' inspect --file $encryptedFile
    if ($LASTEXITCODE -ne 0) { throw 'Falhou a inspecao do backup PostgreSQL.' }

    Write-Host ''
    Write-Host 'COPIA CRIPTOGRAFADA CRIADA E INSPECIONADA.' -ForegroundColor Green
    Write-Host "Arquivo: $encryptedFile"
    Write-Host "Manifesto: $manifestFile"
    Write-Host 'IMPORTANTE: uma restauracao isolada ainda precisa ser testada.'
    Write-Host 'Se a pasta nao for sincronizada pelo Google Drive para computador,'
    Write-Host 'envie APENAS o arquivo .nisti.enc e o manifesto .nisti.json.'
    Write-Host 'Nunca envie .dump sem criptografia. Guarde a senha fora do Drive.'
    Write-Host 'As imagens do R2 exigem backup separado.'
  }
} catch {
  $exitCode = 1
  Write-Host ''
  Write-Host ('FALHA SEGURA: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Nenhum dado da producao foi apagado ou alterado por este assistente.'
} finally {
  foreach ($item in @('PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGSSLMODE',
                       'PGPASSWORD', 'NISTI_BACKUP_PASSPHRASE', 'NISTI_BACKUP_MAX_MB')) {
    Remove-Item -Path ('Env:' + $item) -ErrorAction SilentlyContinue
  }
  if ($locationChanged) { Pop-Location }
  $dbPassword = $null
  $backupPassword = $null
}
exit $exitCode
