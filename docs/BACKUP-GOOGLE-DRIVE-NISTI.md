# Backup criptografado do NISTI no Google Drive (sem serviço pago)

## Pastas já criadas no Drive conectado

- [NISTI - Backups do Sistema](https://drive.google.com/drive/folders/1Xl2WOi8cIbSdtcfe5QN4RKOgMbDvsDRH)
- [Banco Supabase - Criptografado](https://drive.google.com/drive/folders/1NLHGupXAkruguY3k63KVICHWKT66zuCN)
- [Imagens R2 - Criptografadas](https://drive.google.com/drive/folders/1sXQhNwBFcBC1YLIWeat69_zERmVJgkzu)

As três pastas foram verificadas como privadas no momento da criação. Não alterar o compartilhamento para **Qualquer pessoa com o link**.

**Estado atual: as pastas existem, mas o backup do banco AINDA NÃO foi produzido.** A conexão do Google Drive permite organizar arquivos, mas não fornece a senha privada do PostgreSQL nem exporta automaticamente o banco inteiro.

## Como executar sem exceder o Free


### Modo assistido no Windows (recomendado para quem não usa terminal)

O NISTI possui o iniciador `scripts/iniciar-backup-nisti.cmd`. Ele **não faz backup automaticamente**: abre um assistente que pede os dados da conexão do PostgreSQL, a senha do banco, uma **senha diferente para criptografia** e a pasta de destino, tudo no próprio computador. Nunca informe senhas no chat.

1. Instale Node.js e as ferramentas cliente **PostgreSQL 17** (`psql`, `pg_dump` e `pg_restore`) e deixe-as disponíveis no PATH do Windows.
2. No [Supabase → Connect](https://supabase.com/dashboard/project/yioetdcbgorunwgwuawg), consulte o host, usuário e porta corretos. Use o pooler informado pelo Supabase se sua rede não oferecer IPv6. **Não forneça aqui sua senha.**
3. Abra a pasta local do projeto NISTI e clique duas vezes em `scripts/iniciar-backup-nisti.cmd`.
4. Informe a pasta **já existente** `Banco Supabase - Criptografado` do Google Drive para computador, se estiver sincronizada. Caso não use o aplicativo Drive, pressione Enter para criar a pasta `NISTI-Criptografado` no seu perfil do Windows.
5. O assistente consulta o tamanho do banco primeiro e só exporta quando você digitar **BACKUP**. O limite preventivo permanece em 100 MB. Depois, valida a criptografia e inspeciona a estrutura do arquivo sem restaurar dados no banco real.
6. Na pasta de destino, confira os dois arquivos `.nisti.enc` e `.nisti.json`. Se escolheu armazenamento local, envie **apenas esses dois** para a pasta privada do Google Drive e mantenha a senha de criptografia fora do Drive.

**Limites:** a cópia não inclui imagens do R2 nem substitui um teste de restauração em PostgreSQL isolado. A exportação consome egress da franquia gratuita. O iniciador usa PowerShell local com `RemoteSigned` e não grava senhas no repositório. Se o Windows impedir a execução, confira as políticas do computador em vez de reduzir indiscriminadamente a proteção.


A cópia é gerada no computador com o cliente PostgreSQL 17, comprimida e **criptografada antes de chegar ao Google Drive**. Não usa Supabase Storage, Cloudflare R2, GitHub Artifacts ou outro projeto de banco.

1. Instale Google Drive para computador, Node.js e o cliente PostgreSQL 17 (`pg_dump`, `pg_restore`, `psql`) no computador Windows usado para administração do NISTI. Alternativa: sem Drive para computador, salve numa pasta privada local e **envie manualmente só os arquivos `.nisti.enc` e `.nisti.json` pela interface web do Drive**.
2. No aplicativo Google Drive para computador, abra a pasta **Banco Supabase - Criptografado** já existente dentro de **NISTI - Backups do Sistema**, e copie o caminho local mostrado no Explorador de Arquivos. **Não basta criar uma pasta nova com o mesmo nome em outro local.**
3. Verifique espaço livre no Drive; o espaço é compartilhado com outros arquivos do Google. Na consulta de 21/10/2026, o banco ocupava aproximadamente **71 MiB** (74.378.387 bytes); o arquivo comprimido não foi medido e a exportação consome franquia de rede (egress).
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
- Depois, no computador com `pg_restore` instalado, execute **inspeção estrutural do arquivo descriptografado**, sem conectar ao Supabase:

```powershell
node scripts/nisti-drive-backup.mjs inspect --file "CAMINHO\ARQUIVO.nisti.enc"
```

O comando `inspect` descifra o arquivo em pasta temporária local, executa `pg_restore --list` e apaga o arquivo temporário ao terminar (inclusive em caso de erro). **Não executa restauração e não torna o backup restaurável por si só.** É uma segunda verificação para detectar arquivos ilegíveis antes do teste de restauração em um PostgreSQL isolado. Não faça isso com conteúdo desconhecido ou recebido de terceiros.

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
