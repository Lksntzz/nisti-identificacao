# Backup criptografado do NISTI no Google Drive (sem serviço pago)

## Pastas já criadas no Drive conectado

- [NISTI - Backups do Sistema](https://drive.google.com/drive/folders/1Xl2WOi8cIbSdtcfe5QN4RKOgMbDvsDRH)
- [Banco Supabase - Criptografado](https://drive.google.com/drive/folders/1NLHGupXAkruguY3k63KVICHWKT66zuCN)
- [Imagens R2 - Criptografadas](https://drive.google.com/drive/folders/1sXQhNwBFcBC1YLIWeat69_zERmVJgkzu)

As três pastas foram verificadas como privadas no momento da criação. Não alterar o compartilhamento para **Qualquer pessoa com o link**.

**Estado atual: as pastas existem, mas o backup do banco AINDA NÃO foi produzido.** A conexão do Google Drive permite organizar arquivos, mas não fornece a senha privada do PostgreSQL nem exporta automaticamente o banco inteiro.

## Como executar sem exceder o Free

A cópia é gerada no computador com o cliente PostgreSQL 17, comprimida e **criptografada antes de chegar ao Google Drive**. Não usa Supabase Storage, Cloudflare R2, GitHub Artifacts ou outro projeto de banco.

1. Instale Google Drive para computador, Node.js e o cliente PostgreSQL 17 (`pg_dump`, `pg_restore`, `psql`) no computador Windows usado para administração do NISTI. Alternativa: sem Drive para computador, salve numa pasta privada local e **envie manualmente só os arquivos `.nisti.enc` e `.nisti.json` pela interface web do Drive**.
2. No aplicativo Google Drive para computador, abra a pasta **Banco Supabase - Criptografado** já existente dentro de **NISTI - Backups do Sistema**, e copie o caminho local mostrado no Explorador de Arquivos. **Não basta criar uma pasta nova com o mesmo nome em outro local.**
3. Verifique espaço livre no Drive; o espaço é compartilhado com outros arquivos do Google. No Supabase atual, o banco ocupa cerca de 67 MB, mas o tamanho real comprimido não foi medido e há consumo de rede (egress) ao exportar.
4. No [Supabase → Connect](https://supabase.com/dashboard/project/yioetdcbgorunwgwuawg), obtenha o host, a porta e o usuário do banco. Não compartilhe a senha no chat ou em qualquer arquivo do GitHub.
5. Execute **PowerShell** com o repositório NISTI já disponível localmente e as ferramentas PostgreSQL no PATH:

```powershell
$env:PGHOST = "HOST_DA_CONEXAO_DO_SUPABASE"
$env:PGPORT = "5432"
$env:PGUSER = "USUARIO_DA_CONEXAO"
$env:PGDATABASE = "postgres"
$env:PGSSLMODE = "require"

$dbPassword = Read-Host "Senha PostgreSQL" -AsSecureString
$env:PGPASSWORD = [System.Net.NetworkCredential]::new("", $dbPassword).Password

# Senha EXCLUSIVA para criptografar as cópias: mínimo 20 caracteres.
# Guarde-a em um gerenciador de senhas FORA do Google Drive.
$secret = Read-Host "Senha de criptografia do backup" -AsSecureString
$env:NISTI_BACKUP_PASSPHRASE = [System.Net.NetworkCredential]::new("", $secret).Password

node scripts/nisti-free-backup.mjs status
node scripts/nisti-drive-backup.mjs plan

# Substitua pelo caminho real da pasta Google Drive sincronizada.
node scripts/nisti-drive-backup.mjs backup --output-dir "G:\Meu Drive\NISTI - Backups do Sistema\Banco Supabase - Criptografado"

# Limpar senhas da sessão
Remove-Item Env:PGPASSWORD
Remove-Item Env:NISTI_BACKUP_PASSPHRASE
```

O caminho `G:\Meu Drive\...` acima é somente um exemplo. Confirme a localização da pasta existente no seu PC.

O processo deixa apenas dois arquivos no destino: o backup **`.nisti.enc`** (criptografado com AES-256-GCM e chave derivada com scrypt) e o manifesto **`.nisti.json`** (SHA-256, data, formato e indicação de que imagens R2 não estão incluídas). O banco em formato legível existe temporariamente apenas no computador e é removido ao final, inclusive se o processo falhar.

## Conferir antes de considerar backup válido

- Verifique no Google Drive Web que **ambos** os arquivos aparecem na pasta correta e não foram truncados.
- No computador, use a mesma senha de criptografia para testar a integridade sem gravar o conteúdo descriptografado:

```powershell
node scripts/nisti-drive-backup.mjs verify --file "CAMINHO\ARQUIVO.nisti.enc"
```

- Verifique a assinatura SHA-256 do arquivo criptografado com `Get-FileHash` comparando com o manifesto.
- `verify` confirma a criptografia e a íntegra dos bytes; **não comprova que o banco seja restaurável**. A restauração completa deve ser testada localmente num PostgreSQL separado, sem escrever no Supabase de produção.
- Se perder a senha de criptografia, **não será possível recuperar o conteúdo**. O Google Drive não guarda essa senha.

## Limites e segurança

- O programa bloqueia o backup quando o tamanho do banco ultrapassa **100 MB** por padrão. O teto usa o tamanho total do banco como critério conservador, mas **não mede o consumo real da franquia mensal de egress**.
- Não há agendamento automático, serviço pago, cobrança ativada ou upload de dumps não criptografados.
- **Não use o `scripts/nisti-free-backup.mjs backup` direto dentro da pasta Google Drive**, pois esse comando gera um `.dump` não criptografado. Use somente `scripts/nisti-drive-backup.mjs backup`.
- Backups das **imagens R2** ainda precisam ser planejados separadamente após conferir as operações e o consumo do bucket Cloudflare; eles não fazem parte desta primeira cópia.
- A primeira exportação real não foi executada durante a configuração do Drive porque a conexão PostgreSQL privada está disponível apenas para o administrador.

## Acompanhamento

- [x] Pasta do Google Drive para banco criada e verificada como privada.
- [x] Pasta separada para imagens criada e verificada como privada.
- [x] Ferramenta de backup com criptografia antes da sincronização.
- [ ] Primeira exportação criptografada gerada no computador.
- [ ] Presença dos dois arquivos confirmada no Google Drive.
- [ ] Integridade e restauração independente verificadas.
- [ ] Backup criptografado de imagens R2 após verificar as cotas.
