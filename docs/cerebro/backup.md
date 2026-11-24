# Backup do NISTI (banco Supabase e imagens R2)

> [!info] Estado em 24/11/2026: existe um backup externo verificado do banco
> Primeiro backup externo do banco gerado no computador do administrador e restaurado com sucesso num PostgreSQL local isolado (ver "Backup externo de 24/11/2026"). A cópia fica numa pasta privada fora do Git. **Isso vale para aquela data**: antes de qualquer mudança arriscada, gerar outro. Conferir também no painel do Supabase: Database → Backups (quais existem, data, retenção, custo).

Esta nota junta e substitui três documentos que se repetiam (`BACKUP-GRATUITO-NISTI`, `BACKUP-GOOGLE-DRIVE-NISTI` e `GOOGLE-DRIVE-BACKUP-NISTI`). Plano geral de proteção: [[PLANO-PROTECAO-E-RECUPERACAO]].

## Backup externo de 24/11/2026 (resultado, sem dados comerciais)

| Item | Valor |
|---|---|
| Data (UTC) | 2026-11-24 19:27 |
| Servidor | PostgreSQL 17.6 (Supabase, sa-east-1) |
| Escopo | schemas do app: `public`, `backup`, `commerce_cutover_backup_20260926`, `supabase_migrations` (226 tabelas) |
| Tamanho | pasta 18,8 MB; dump 16,2 MB (16.954.111 bytes) |
| SHA-256 do dump | `734c74248e89fc73db95d434d06fcd314aea19da85242340e2b10bfe55adb79b` |
| Restauração | PASS em PostgreSQL local temporário (127.0.0.1), 56 s, produção intocada |

**Como foi feito:** ferramentas externas ao Git (somente leitura na produção, senha digitada pelo administrador, nunca gravada). O backup congela um *snapshot* único (contagens, hash do conteúdo, inventários e `pg_dump` no mesmo instante) e grava, além do dump, os inventários de permissões, políticas RLS, proprietários, extensões e agendamentos, com `SHA256SUMS`.

**Critério do teste de restauração (PASS só se tudo valer):**
1. Todos os arquivos obrigatórios presentes, não vazios e com SHA-256 correto.
2. Zero erros do `pg_restore` (única exceção contada: o schema `public` já existe) e zero falhas ao recriar perfis e extensões necessárias ao app. Extensões só da plataforma (`http`, `pg_cron`, `supabase_vault`) só são toleradas se nenhum objeto do app as usar.
3. Cada tabela com mesma contagem **e mesmo hash de conteúdo** do snapshot.
4. Inventário de objetos (tabelas, views, sequências, funções, triggers, índices, políticas) igual.
5. Definições das políticas RLS e RLS ligado/forçado iguais.
6. Permissões (GRANT, inclusive `WITH GRANT OPTION` e por coluna) iguais **depois de reaplicar `permissoes-reaplicar.sql`**.
Proprietários originais ficam no inventário `donos.tsv`; a diferença após `--no-owner` é informativa.

### Recuperação completa: reaplicar as permissões é OBRIGATÓRIO
O `pg_dump` só revoga permissões de PUBLIC e do dono. Num banco do Supabase, os privilégios padrão da plataforma concedem a `anon`, `authenticated` e `service_role` acesso a objetos novos; objetos que a produção havia restringido voltam **abertos demais**. No teste, sem a reaplicação houve mais de mil permissões a mais (EXECUTE de `anon` e `authenticated` em todas as funções do app e acesso a mais de uma centena de tabelas); com ela, zero divergências. Portanto, numa recuperação completa:
1. Restaurar o dump (`pg_restore --no-owner`).
2. **Rodar `permissoes-reaplicar.sql`** (gerado a cada backup; revoga tudo dos perfis e concede exatamente o que a produção tinha). Sem este passo a recuperação não está concluída.
3. Reaplicar proprietários que diferirem de `postgres` a partir de `donos.tsv` e conferir políticas RLS.
4. Conferir contagens e testar o app (login, telas do GA) antes de religar o tráfego.

### Reverter a migração GA-021 NÃO é restaurar o banco
| | Reversão da GA-021 | Restauração integral |
|---|---|---|
| O que é | `docs/reversao/GA-021-reversao.sql` (bloco `DO`) | `pg_restore` do backup externo |
| Efeito | Devolve só as dez funções à leitura da tabela legada e limpa 4 famílias de cache; não toca em vendas, lotes, snapshots nem tabelas | Substitui o conteúdo do banco pelo do dia do backup (perde tudo que veio depois) |
| Quando | Problema causado só pela migração (telas de Categorias/ABC/frete) | Perda ou corrupção de dados |
| Custo | Reintroduz o defeito dos lotes abertos, mas sem perda de dados | Perda de dados posteriores ao backup; exige reaplicar permissões |
| Backup necessário | Já existe (24/11/2026) | Backup mais recente possível |
Nunca usar a restauração integral para desfazer só a GA-021.

### Limites conhecidos
- Não houve ensaio de restauração num projeto Supabase novo (o teste usou PostgreSQL local com privilégios padrão simulados).
- Schemas internos do Supabase (`auth`, `storage`, `vault`, `cron`, `realtime`) fora do dump: na data estavam vazios (as tarefas do `pg_cron` ficam registradas). Revisar o escopo se passarem a ter conteúdo.
- Chaves de API e segredos (Cloudflare, GitHub) não fazem parte do banco.
- O `.dump` contém dados comerciais: pasta privada, fora do Git, nunca no Drive sem criptografia.

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

## Pendência de infraestrutura: backup externo do banco (registrada em 24/11/2026)

**Decisão do dono:** publicar a GA-019 **sem** o backup externo criptografado. Ele continua sendo uma pendência de infraestrutura do NISTI ID, sem data definida.

- **O que cobre hoje:** só a cópia interna das 12 tabelas de vendas (`backup.pre_ga019__*`, conteúdo conferido linha a linha em 24/11/2026) e o backup semanal interno (`backup.take_snapshot_v1`, 4 versões, 12 tabelas do catálogo e vendas). Ambos ficam **dentro do mesmo banco do Supabase**.
- **O que não cobre:** perda ou corrupção do projeto Supabase inteiro, erro de quem tem acesso ao banco, e as demais ~126 tabelas do `public` e os schemas `auth`/`storage`. Nada disso sobrevive fora do Supabase. O plano gratuito não tem backup automático próprio.
- **Para fechar:** seguir "Passo a passo no Windows" e "Teste de restauração" acima (limite de 300 MB já ajustado) e marcar os itens do "Estado". Recomendado antes da próxima mudança estrutural no banco.

## Imagens R2 (pendente)

O dump do PostgreSQL **não contém** as imagens do R2. Não usar o antigo exportador baseado em D1. Antes de copiar: conferir cota e operações no painel da Cloudflare, levantar o índice **atual** de chaves a partir do Supabase, fazer uma amostra pequena em disco local privado, conferir SHA-256 e só então autorizar a cópia integral. O workflow manual de índice e ZIP criptografado está em [[EXPORTAR-IMAGENS-ORIGINAIS-SUPABASE]] e também não substitui backup.

## Frequência

Uma vez por semana no início, e antes de grande importação ou mudança no banco. Guardar poucas versões (por exemplo, as últimas 4) em disco privado. Nunca rodar várias seguidas sem necessidade.

## Estado (conferir e atualizar aqui)

- [x] Pastas privadas criadas no Drive (banco e imagens).
- [x] Scripts de backup criptografado, com limite de 300 MB e conferência de integridade.
- [ ] Primeira exportação criptografada gerada no computador do administrador. **PENDENTE (decisão de 24/11/2026: publicar a GA-019 sem ela).**
- [ ] Dois arquivos confirmados no Drive.
- [ ] Integridade verificada e restauração de teste em PostgreSQL isolado.
- [ ] Backup das imagens do R2, depois de checar as cotas.
- [ ] Painel do Supabase conferido (Database → Backups).
