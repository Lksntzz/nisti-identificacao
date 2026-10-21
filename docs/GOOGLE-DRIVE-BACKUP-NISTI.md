# Backup NISTI no Google Drive sem planos pagos

## Situação atual

Foram criadas e conferidas como PRIVADAS na conta conectada as pastas:
- NISTI - Backups do Sistema
- Banco Supabase - Criptografado
- Imagens R2 - Criptografadas

**Atenção:** ainda não existe backup real nessas pastas. A exportação integral PostgreSQL exige as credenciais de acesso no computador do administrador.

O banco utilizava aproximadamente 67 MiB (13,31% do teto de 500 MiB) em 21/10/2026. A exportação não usa espaço no banco, mas consome franquia de rede. O tamanho atual da cota Google Drive desta conta **não foi consultado**. Verifique o espaço em https://one.google.com/storage antes do primeiro envio.

## Regras de segurança

1. Somente enviar arquivos terminados em .nisti.enc e .nisti.json, NUNCA arquivos .dump não criptografados.
2. Não compartilhar a pasta com outros usuários ou links públicos.
3. Criar uma senha exclusiva, longa (mínimo de 20 caracteres), para o backup. Ela não pode ser a senha do Supabase. Guardar essa senha FORA do Drive; sem ela não é possível recuperar a cópia.
4. Não criar outro projeto Supabase, cron de backups ou R2 bucket pago.
5. O script bloqueia exportações se o banco tiver mais de 100 MiB por padrão. Essa verificação não mede a franquia de tráfego mensal.
6. O script deixa o .dump temporário apenas na pasta temporária local e remove após a criptografia. Um desligamento abrupto pode deixar esse temporário no PC, que deverá ser conferido.

## Preparar o computador Windows

Instalar Node.js e as ferramentas cliente PostgreSQL 17 (psql, pg_dump, pg_restore), se ainda não houver. Clonar o repositório NISTI, criar a pasta privada C:\NISTI-Criptografado e abrir o PowerShell na raiz do projeto.

No painel do Supabase → Connect, obter a configuração PostgreSQL de host, porta e usuário. Nunca enviar senhas neste chat.

Execute no PowerShell, substituindo os exemplos pelos dados mostrados no Supabase:

    $env:PGHOST = "HOST_INFORMADO_PELO_SUPABASE"
    $env:PGPORT = "5432"
    $env:PGUSER = "USUARIO_INFORMADO_PELO_SUPABASE"
    $env:PGDATABASE = "postgres"
    $env:PGSSLMODE = "require"

    $databaseSecret = Read-Host "Senha PostgreSQL" -AsSecureString
    $env:PGPASSWORD = [System.Net.NetworkCredential]::new("", $databaseSecret).Password

    $backupSecret = Read-Host "Senha EXCLUSIVA de 20+ caracteres para o backup" -AsSecureString
    $env:NISTI_BACKUP_PASSPHRASE = [System.Net.NetworkCredential]::new("", $backupSecret).Password

    node scripts/nisti-free-backup.mjs status
    node scripts/nisti-drive-backup.mjs backup --output-dir "C:\NISTI-Criptografado"

    Remove-Item Env:PGPASSWORD
    Remove-Item Env:NISTI_BACKUP_PASSPHRASE

A pasta C:\NISTI-Criptografado deve existir antes do comando. O script usa AES-256-GCM e confere a integridade sem escrever dados no Google Drive ainda.

Se preferir Google Drive para computador, é possível usar como output-dir o caminho completo **da pasta local sincronizada** para Banco Supabase - Criptografado; o programa grava apenas arquivos criptografados nesse caminho. Verificar que o Drive está autenticado e a sincronização concluída.

## Enviar pelo Google Drive no navegador

1. Abrir a pasta Banco Supabase - Criptografado na pasta principal NISTI - Backups do Sistema.
2. Carregar somente os dois arquivos gerados na pasta privada local: o arquivo .nisti.enc e o manifesto .nisti.json.
3. Conferir no Drive a data, nome e tamanho dos arquivos. NÃO carregar os arquivos .dump nem as senhas.
4. Manter cópia adicional criptografada no disco privado ou HD externo.

## Validar

Pode verificar um arquivo criptografado no PC sem gravar texto puro:

    $backupSecret = Read-Host "Senha do backup" -AsSecureString
    $env:NISTI_BACKUP_PASSPHRASE = [System.Net.NetworkCredential]::new("", $backupSecret).Password
    node scripts/nisti-drive-backup.mjs verify --file "C:\NISTI-Criptografado\NOME.nisti.enc"
    Remove-Item Env:NISTI_BACKUP_PASSPHRASE

A conferência de AES-GCM e hash SHA-256 NÃO substitui teste de restauração. Jamais restaurar diretamente sobre produção sem orientação técnica.

## Imagens do Cloudflare R2

Continuam pendentes. O dump PostgreSQL não contém os arquivos do bucket R2. A cota/consumo R2 precisa ser verificada antes de iniciar a exportação das imagens. Não use a rotina antiga indexada pelo banco D1 para isso.

## Status

- [x] Pastas privadas criadas no Google Drive.
- [x] Preparado programa de backup criptografado com limite padrão de 100 MiB.
- [ ] Confirmar espaço livre da conta Drive.
- [ ] Executar exportação no PC com credenciais autorizadas.
- [ ] Confirmar os arquivos .nisti.enc/.json no Drive.
- [ ] Fazer teste de restauração local e backup de imagens R2.
