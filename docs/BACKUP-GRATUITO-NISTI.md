# Backup NISTI sem aumentar os custos do plano gratuito

**Google Drive já preparado:** siga primeiro [Backup NISTI criptografado no Google Drive](GOOGLE-DRIVE-BACKUP-NISTI.md). Nunca carregue arquivos .dump sem criptografia no Drive.

**Modo de uso:** manual no computador do administrador. **O script NÃO roda no Worker,
não escreve no Supabase, não cria outro banco, não agenda tarefas e não envia arquivos
ao GitHub ou ao R2.**

## 1. Consumo confirmado em 21/10/2026

| Item | Situação |
| --- | --- |
| Supabase database | 69.758.099 bytes (aprox. 67 MB em unidades binárias) |
| Limite do Free | 500 MB |
| Utilização atual | 13,31% |
| Espaço restante estimado | 433 MB |
| Estado do projeto | ACTIVE_HEALTHY |
| Backup atual recuperável | Ainda **não confirmado** |

Uma cópia local não ocupa espaço extra no banco. **Mas exportações consomem saída de rede (egress)**;
por isso, a execução é manual, com limitação padrão de **100 MB de tamanho do banco**.
Esse limite é um bloqueio preventivo baseado no tamanho informado pelo PostgreSQL,
**não** um medidor preciso da franquia mensal de rede.

A franquia de egress do Free é compartilhada conforme as regras atuais do Supabase.
Veja a [cota do plano](https://supabase.com/pricing), [tamanho do banco](https://supabase.com/docs/guides/platform/database-size) e [backups no Free](https://supabase.com/docs/guides/platform/backups).
Não ativar Pro, PITR, branches de desenvolvimento nem mais projetos só para fazer backup.

## 2. Preparar uma pasta privada no computador Windows

1. Instale somente as ferramentas de cliente PostgreSQL **17** (\`psql\`, \`pg_dump\`, \`pg_restore\`) e Node.js, caso ainda não existam.
2. Crie a pasta **C:\Backup-NISTI** ou uma pasta em HD externo privado. **Fora** do projeto GitHub e de pastas compartilhadas.
3. Verifique espaço livre suficiente (recomendado pelo menos 2 vezes o tamanho do banco) e proteja o disco com BitLocker ou criptografia equivalente.
4. No [Supabase → Connect](https://supabase.com/dashboard/project/yioetdcbgorunwgwuawg), copie separadamente **host**, **porta**, **usuário** e **nome do banco** da string de conexão PostgreSQL. Se a rede não aceitar conexão IPv6 direta, consulte a opção **Session pooler**. Nunca envie senhas a terceiros ou ao chat.
5. No PowerShell, já com o repositório NISTI instalado localmente:

\`\`\`powershell
# Substitua pelos dados da conexão PostgreSQL exibidos no Supabase.
$env:PGHOST = "HOST_DA_CONEXAO"
$env:PGPORT = "5432"
$env:PGUSER = "USUARIO_DA_CONEXAO"
$env:PGDATABASE = "postgres"
$env:PGSSLMODE = "require"
$credencial = Read-Host "Senha PostgreSQL (não exibida)" -AsSecureString
$env:PGPASSWORD = [System.Net.NetworkCredential]::new("", $credencial).Password

# 1) Verificar tamanho e uso sem exportar dados.
node scripts/nisti-free-backup.mjs status

# 2) Somente quando estiver pronto para gerar a cópia no computador:
node scripts/nisti-free-backup.mjs backup --output-dir "C:\Backup-NISTI"

# 3) Limpar a senha da sessão do PowerShell após o backup.
Remove-Item Env:PGPASSWORD
\`\`\`

**Não copie uma senha real para um arquivo PowerShell, README ou repositório.**
Se o comando de conexão falhar, não tente recriar o banco, alterar tabelas nem ativar funcionalidades pagas.

## 3. O que o script faz

1. Confere acesso ao banco existente usando **somente leitura**.
2. Consulta o tamanho real com \`pg_database_size(current_database())\`.
3. **Recusa** exportação se o tamanho informado passar de **100 MB**, até decisão explícita do administrador. A variável opcional \`NISTI_BACKUP_MAX_MB\` permite aumentar esse teto até 500 MB, mas não deve ser alterada sem verificar a franquia mensal de rede.
4. Rejeita destino dentro do projeto GitHub e exige uma pasta local já existente.
5. Gera um arquivo PostgreSQL comprimido \`.dump\` sem sobrescrever arquivos anteriores.
6. Valida o formato com \`pg_restore --list\` e grava SHA-256 num arquivo \`.json\` ao lado.
7. Em erro, descarta apenas os arquivos incompletos dessa tentativa.

**Atenção:** \`pg_restore --list\` prova a estrutura do arquivo, **não comprova uma restauração completa**. Não escreva/restaure nada no banco de produção como forma de teste.

O arquivo contém dados operacionais e possivelmente credenciais em tabelas protegidas: mantenha o backup criptografado e privado.

## 4. Imagens R2: cópia separada, ainda pendente

O dump PostgreSQL **não contém** os arquivos originais e tratados do bucket R2. Não executar o antigo exportador de imagens baseado em D1 achando que representa o cadastro atual.

O Cloudflare R2 Standard oferece uma franquia própria; a ocupação do bucket e o número de operações desta conta **ainda não foram conferidos**. Uma cópia automática pode consumir operações/transferência, por isso não foi ativada.

Antes de copiar imagens: confirmar quota disponível no painel Cloudflare, levantar índice **atual** de chaves a partir do Supabase, fazer uma pequena cópia de amostra a um HD local privado, conferir SHA-256 e só então autorizar a exportação integral.

## 5. Frequência recomendada

No início, **um backup manual por semana** e outro antes de uma grande importação ou alteração de banco, sempre verificando o consumo/egress no dashboard. Nunca rodar várias cópias seguidas sem necessidade.

Guardar poucas versões em **disco privado** (por exemplo, últimas quatro semanas), sem carregar novamente para o Supabase ou R2. Se precisar de restauração, executar primeiro num ambiente de teste já autorizado, nunca sobre produção.

## 6. Pendências reais

- [x] Conferência gratuita do tamanho do banco, sem alterações.
- [x] Script manual local com limite de tráfego e conferência de integridade.
- [ ] Primeira cópia do banco gerada **no computador do administrador**.
- [ ] Verificar acesso/retenção de backups privados.
- [ ] Conferir o consumo e a quota específica do Cloudflare R2.
- [ ] Cópia íntegra e privada dos objetos R2.
- [ ] Restaurar amostra em ambiente **isolado** (não necessariamente um projeto Supabase pago).
