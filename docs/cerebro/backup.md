# Backup do NISTI (banco Supabase e imagens R2)

> [!warning] ATENÇÃO: não há backup do banco confirmado
> Segundo os documentos que esta nota substitui (posição de 21/10/2026), a pasta de backups do banco estava **vazia**: a primeira cópia nunca foi gerada, e a existência de backups recuperáveis no Supabase **não foi confirmada**. Quem executa o procedimento abaixo é o administrador, no computador dele. **Confirmar o estado atual antes de assumir que existe cópia.** Conferir também no painel do Supabase: Database → Backups (quais existem, data, retenção, custo).

Esta nota junta e substitui três documentos que se repetiam (`BACKUP-GRATUITO-NISTI`, `BACKUP-GOOGLE-DRIVE-NISTI` e `GOOGLE-DRIVE-BACKUP-NISTI`). Plano geral de proteção: [[PLANO-PROTECAO-E-RECUPERACAO]].

## Regras que não mudam

1. Só planos gratuitos. Não ativar Pro, PITR, branches de desenvolvimento nem outro projeto só para backup.
2. **Nunca enviar `.dump` sem criptografia ao Drive ou a qualquer pasta sincronizada.** Só sobem arquivos `.nisti.enc` e `.nisti.json`.
3. A senha de criptografia (mínimo 20 caracteres, diferente da senha do Supabase) fica **fora do Drive**, num gerenciador de senhas. Sem ela, o backup não se recupera.
4. Nunca digitar senhas no chat, em arquivo do repositório (é público) nem em script. O PowerShell pede por `Read-Host`, e as variáveis são apagadas no fim.
5. Pastas do Drive privadas. Nunca compartilhar como "Qualquer pessoa com o link".
6. Execução **manual**. O script não roda no Worker, não escreve no Supabase, não agenda nada e não envia a GitHub ou R2.
7. Exportar consome egress (rede) da franquia gratuita. Por isso o script recusa bancos acima de **300 MB** por padrão (`NISTI_BACKUP_MAX_MB` aumenta até 500, só depois de checar a franquia mensal; o plano gratuito inclui 5 GB de rede por mês). Esse teto é preventivo, não mede a franquia real. Era 100 MB até 23/11/2026, quando o banco já tinha 202 MB; 300 MB deixa cerca de 50% de folga.
8. Nunca restaurar sobre produção. Teste de restauração só em PostgreSQL isolado.

## O que o backup cobre

- **Cobre:** o banco PostgreSQL (Supabase).
- **Não cobre:** as imagens do R2. Esse backup está **pendente** (ver "Imagens R2").
- Cópias semanais dentro do próprio banco (schema `backup`, ver [[MAPA-GA]]) **não substituem** backup externo: se o banco se perder, elas se perdem juntas.

## Passo a passo no Windows (criptografado, recomendado)

**Preparação (uma vez)**
1. Instalar Node.js e as ferramentas cliente do **PostgreSQL 17** (`psql`, `pg_dump`, `pg_restore`), com PATH do Windows.
2. Ter o repositório baixado localmente.
3. No painel do Supabase → Connect, anotar **host, porta e usuário** (não a senha). Se a rede não aceitar IPv6, usar o Session pooler.
4. Decidir o destino: pasta do Google Drive para computador (`Banco Supabase - Criptografado`, dentro de `NISTI - Backups do Sistema`) ou uma pasta privada local, enviando depois os dois arquivos pelo site do Drive.

**Opção mais simples (sem terminal):** dar dois cliques em `scripts/iniciar-backup-nisti.cmd`. O assistente pergunta os dados da conexão, a senha do banco, a senha de criptografia e a pasta de destino; consulta o tamanho do banco e só exporta quando você digitar **BACKUP**.

**Opção pelo PowerShell**, na raiz do projeto:

```powershell
$env:PGHOST = "HOST_DO_SUPABASE"
$env:PGPORT = "5432"
$env:PGUSER = "USUARIO_DO_SUPABASE"
$env:PGDATABASE = "postgres"
$env:PGSSLMODE = "require"

$dbPassword = Read-Host "Senha PostgreSQL" -AsSecureString
$env:PGPASSWORD = [System.Net.NetworkCredential]::new("", $dbPassword).Password
$secret = Read-Host "Senha de criptografia (20+ caracteres)" -AsSecureString
$env:NISTI_BACKUP_PASSPHRASE = [System.Net.NetworkCredential]::new("", $secret).Password

node scripts/nisti-free-backup.mjs status          # tamanho e uso, sem exportar
node scripts/nisti-drive-backup.mjs plan
node scripts/nisti-drive-backup.mjs backup --output-dir "CAMINHO\DA\PASTA\JA\EXISTENTE"

Remove-Item Env:PGPASSWORD
Remove-Item Env:NISTI_BACKUP_PASSPHRASE
```

A pasta de destino precisa existir antes. No fim ficam só dois arquivos: `.nisti.enc` (AES-256-GCM, chave derivada com scrypt) e `.nisti.json` (SHA-256, data, formato, aviso de que não inclui R2). O dump legível existe só temporariamente no computador e é apagado ao final, mesmo em falha. Em desligamento abrupto o temporário pode ficar no PC: conferir.

## Conferir antes de considerar válido

1. No Drive (site), os **dois** arquivos aparecem, com nome, data e tamanho corretos.
2. Mesma senha de criptografia, sem gravar texto puro:
   ```powershell
   node scripts/nisti-drive-backup.mjs verify --file "CAMINHO\ARQUIVO.nisti.enc"
   node scripts/nisti-drive-backup.mjs inspect --file "CAMINHO\ARQUIVO.nisti.enc"
   ```
   `verify` confirma criptografia e integridade dos bytes. `inspect` descriptografa numa pasta temporária, roda `pg_restore --list` e apaga o temporário. **Nenhum dos dois prova que o banco é restaurável.**
3. Comparar o SHA-256 do arquivo (`Get-FileHash`) com o do manifesto.
4. Só a **restauração de teste em PostgreSQL isolado** prova que o backup serve.

## Alternativa: cópia local sem criptografia

`node scripts/nisti-free-backup.mjs backup --output-dir "C:\Backup-NISTI"` gera um `.dump` comprimido, valida com `pg_restore --list` e grava SHA-256. **Não é criptografado:** a pasta precisa ficar **fora do projeto GitHub e de qualquer pasta sincronizada**, em disco protegido (BitLocker ou equivalente), com espaço livre de pelo menos 2x o tamanho do banco. Nunca usar esse comando dentro da pasta do Drive. O arquivo pode conter dados sensíveis e credenciais de tabelas protegidas.

## Teste de restauração em PostgreSQL isolado (Windows)

Só isto prova que o backup serve. Faça **depois** de `verify` e `inspect`. O teste restaura numa cópia local do PostgreSQL, no seu computador, **nunca** no Supabase.

**Regra de ouro:** use uma janela nova do PowerShell, sem nenhuma variável `PG...` definida na sessão do backup. Todo comando abaixo leva `-h localhost -p 5433`, para nunca apontar para o Supabase por engano.

1. **Instalar o servidor local (uma vez).** Baixe o instalador do PostgreSQL 17 para Windows em postgresql.org → Download → Windows. Marque **PostgreSQL Server** e **Command Line Tools**; desmarque Stack Builder. Porta: **5433** (não a 5432). Crie uma senha **nova e só local** para o usuário `postgres` (não é a do Supabase; anote no gerenciador de senhas). No fim, o Windows passa a ter o serviço do PostgreSQL 17 rodando só neste computador.
2. **Janela nova do PowerShell.** Confira que está falando com o seu computador:
   ```powershell
   Get-ChildItem Env:PG* | Format-Table      # deve vir vazio (se aparecer PGHOST, feche e abra outra janela)
   psql -h localhost -p 5433 -U postgres -d postgres -c "select inet_server_addr(), current_setting('port')"
   ```
   Peça a senha local. O resultado deve mostrar `127.0.0.1` (ou `::1`) e a porta `5433`. Qualquer outro endereço: **pare**.
3. **Criar uma pasta temporária** fora do projeto e fora do Drive, por exemplo `C:\Teste-Restauracao`. Ela vai guardar o `.dump` **sem criptografia**: apague no fim.
4. **Descriptografar** (na raiz do projeto; digite a senha do backup quando o PowerShell pedir):
   ```powershell
   $s = Read-Host "Senha de criptografia do backup" -AsSecureString
   $env:NISTI_BACKUP_PASSPHRASE = [System.Net.NetworkCredential]::new("", $s).Password
   node scripts/nisti-drive-backup.mjs decrypt --file "CAMINHO\ARQUIVO.nisti.enc" --output-dir "C:\Teste-Restauracao"
   Remove-Item Env:NISTI_BACKUP_PASSPHRASE
   ```
   Esperado: "Arquivo PostgreSQL recuperado localmente". "Senha incorreta ou backup inválido" = senha errada ou arquivo corrompido (também aparece como "Unsupported state or unable to authenticate data" nos comandos `verify` e `inspect`).
5. **Restaurar:**
   ```powershell
   psql -h localhost -p 5433 -U postgres -d postgres -c "create database nisti_teste"
   pg_restore -h localhost -p 5433 -U postgres -d nisti_teste --no-owner --no-acl "C:\Teste-Restauracao\ARQUIVO.dump" 2> "C:\Teste-Restauracao\erros.txt"
   ```
   Pode demorar alguns minutos. **Vão aparecer erros e isso é esperado**: o banco do Supabase usa extensões e papéis que o PostgreSQL comum não tem (`pg_cron`, `http`, `supabase_vault`, `anon`, `authenticated`...). Abra `erros.txt`: erros desse tipo (`extension ... is not available`, `role ... does not exist`, políticas de segurança) não importam para este teste. **Importa** é se existe erro em `COPY` ou `CREATE TABLE` de tabelas do `public`: nesse caso, guarde o arquivo e me envie as linhas (sem senhas).
6. **Comparar com o banco de verdade.** Rode o bloco `restore-signature` (de [[ga-019-publicacao]], item 1 do backup) no SQL Editor do Supabase e o mesmo comando no banco restaurado (copie o SQL para um arquivo `assinatura.sql`):
   ```powershell
   psql -h localhost -p 5433 -U postgres -d nisti_teste -f assinatura.sql
   ```
   `tabelas`, `total_de_linhas` e `assinatura` têm de ser **idênticos** aos do Supabase tirados no momento do backup. Idêntico = os dados das 138 tabelas do `public` voltaram com o mesmo número de linhas.
7. **Limpar:**
   ```powershell
   psql -h localhost -p 5433 -U postgres -d postgres -c "drop database nisti_teste"
   Remove-Item -Recurse -Force "C:\Teste-Restauracao"
   ```
   Depois, marque "restauração de teste" no estado abaixo.

**O que este teste prova e o que não prova:** prova que o arquivo é íntegro e que os dados das tabelas voltam completos. Não prova que um projeto Supabase novo ficaria idêntico (autenticação, extensões, funções do `cron`, permissões): numa catástrofe real, a restauração é num projeto Supabase novo, e isso ainda não foi ensaiado.

## Imagens R2 (pendente)

O dump do PostgreSQL **não contém** as imagens do R2. Não usar o antigo exportador baseado em D1. Antes de copiar: conferir cota e operações no painel da Cloudflare, levantar o índice **atual** de chaves a partir do Supabase, fazer uma amostra pequena em disco local privado, conferir SHA-256 e só então autorizar a cópia integral. O workflow manual de índice e ZIP criptografado está em [[EXPORTAR-IMAGENS-ORIGINAIS-SUPABASE]] e também não substitui backup.

## Frequência

Uma vez por semana no início, e antes de grande importação ou mudança no banco. Guardar poucas versões (por exemplo, as últimas 4) em disco privado. Nunca rodar várias seguidas sem necessidade.

## Estado (conferir e atualizar aqui)

- [x] Pastas privadas criadas no Drive (banco e imagens).
- [x] Scripts de backup criptografado, com limite de 300 MB e conferência de integridade.
- [ ] Primeira exportação criptografada gerada no computador do administrador.
- [ ] Dois arquivos confirmados no Drive.
- [ ] Integridade verificada e restauração de teste em PostgreSQL isolado.
- [ ] Backup das imagens do R2, depois de checar as cotas.
- [ ] Painel do Supabase conferido (Database → Backups).
