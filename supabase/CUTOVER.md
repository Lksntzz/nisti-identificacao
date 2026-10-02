# NISTI ID — Cutover D1 → Supabase

## Estado do candidato após o corte de dados

O snapshot final de 22 tabelas foi reconciliado no Supabase. A validação congelada foi concluída e o candidato de liberação usa Supabase como autoridade de leitura e escrita; o D1 foi removido do binding do Worker de produção e permanece somente como banco legado para recuperação controlada:

```text
SUPABASE_URL=https://yioetdcbgorunwgwuawg.supabase.co
SUPABASE_READS_ENABLED=1
SUPABASE_EMERGENCY_FALLBACK_ENABLED=0
SUPABASE_READ_TIMEOUT_MS=5000
SUPABASE_WRITE_MODE=primary
SUPABASE_CUTOVER_WRITE_FREEZE=0
```

`SUPABASE_SERVICE_ROLE_KEY` **não** pode ser versionada. Ela deve existir apenas como segredo server-side do Cloudflare Worker.

## Invariantes de segurança

- Supabase é a autoridade de leitura e escrita do candidato em modo `primary`.
- Os writers operacionais e administrativos ativos possuem caminho direto Supabase; SQL D1 remanescente é compatibilidade/recuperação e não deve ser executado no caminho primário.
- O D1 não é mais um hot standby: depois da liberação das escritas diretas, ele pode ficar defasado e não pode ser usado automaticamente como fallback de leitura.
- O Worker de produção não recebe mais o binding `DB`; comandos de migração/rollback do D1 usam `wrangler.d1-compat.toml`.
- O navegador nunca recebe a service-role key nem acessa o PostgreSQL diretamente.
- Não alterar os thresholds de reconhecimento durante o cutover.
- Não importar `push_logs`; essa tabela permanece legado/diagnóstico fora da autoridade PostgreSQL.
- Não aplicar a migration não mergeada `0014_ambiguous_review_candidates.sql` como parte deste procedimento.
- `postgres-data.sql` é um arquivo de carga inicial. Para a substituição final use **somente** `postgres-final-replace.sql` gerado pelo script NISTI.
- Nunca executar o replace final sem a trava de escrita confirmada em produção.

## Pré-requisitos

Todos os itens abaixo são obrigatórios antes da janela final:

1. schema e RPCs Supabase aplicados e auditados como `SECURITY INVOKER`;
2. `PUBLIC`, `anon` e `authenticated` sem `EXECUTE` nas RPCs privilegiadas;
3. `service_role` com `EXECUTE` nas RPCs necessárias;
4. snapshot final com as 22 tabelas importadas e validado;
5. Production Gate verde na versão a ser implantada;
6. `SUPABASE_SERVICE_ROLE_KEY` configurada no Worker;
7. modo de escrita `primary` fail-closed concluído no código;
8. ferramenta `scripts/build-supabase-final-replace.mjs` presente;
9. `SUPABASE_CUTOVER_WRITE_FREEZE=1` durante toda a sincronização e validação final; somente o release validado altera a flag para `0`.

## Configurar a service-role key

A credencial privilegiada deve ser configurada somente como secret do Cloudflare Worker. Execute localmente:

```powershell
npx.cmd wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Digite o valor diretamente no prompt do Wrangler. Não envie a key por chat, não faça commit dela e não a coloque em `.env` versionado ou em qualquer arquivo de exportação/migração.

## Por que existe uma trava de escrita

O snapshot inicial deixa de ser autoritativo assim que o D1 recebe uma nova escrita. Portanto a sincronização final não pode ser feita com operadores/admin gravando ao mesmo tempo.

Quando:

```text
SUPABASE_CUTOVER_WRITE_FREEZE=1
```

o Worker rejeita `POST`, `PUT`, `PATCH` e `DELETE` em `/api/*` com HTTP 503 antes de qualquer router executar. `GET` continua disponível para health checks. Configuração inválida da flag também falha fechado para mutações.

## Janela final — ordem obrigatória

### 1. Deploy A: mirror preparado + writes congelados

Criar um commit/deploy operacional alterando **somente**:

```toml
SUPABASE_WRITE_MODE = "mirror"
SUPABASE_CUTOVER_WRITE_FREEZE = "1"
SUPABASE_READS_ENABLED = "0"
```

Depois do deploy, confirmar:

- um `GET` de health continua respondendo;
- uma mutação controlada recebe HTTP 503;
- resposta inclui `technical_error=cutover_write_freeze` e `x-nisti-maintenance=supabase-cutover-write-freeze`.

Não prossiga se qualquer escrita ainda alcançar D1.

### 2. Gerar snapshot D1 novo

No clone limpo e na `main` exata implantada, executar o export oficial:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\export-d1-for-supabase.ps1
```

Preservar todos os artefatos e hashes. Não reutilizar o snapshot de uma janela anterior.

### 3. Converter o snapshot

```powershell
node .\scripts\convert-d1-export-for-supabase.mjs "<PASTA_DO_SNAPSHOT>\d1-data.sql"
```

Validar `conversion-report.json` contra `d1-counts.json`. Divergência aborta o cutover.

### 4. Gerar o replace atômico

```powershell
node .\scripts\build-supabase-final-replace.mjs "<PASTA_DO_SNAPSHOT>\postgres-data.sql"
```

O script gera:

```text
postgres-final-replace.sql
final-replace-report.json
```

O SQL gerado:

- abre uma única transação;
- faz `TRUNCATE` exatamente das 21 tabelas operacionais dependentes;
- preserva `products` e o reconcilia por upsert para não quebrar FKs do Catálogo Comercial;
- **não usa CASCADE**;
- reinsere o snapshot preservando IDs;
- sincroniza as sequences IDENTITY;
- executa `COMMIT` somente ao final.

Qualquer dependência relacional inesperada faz o comando falhar em vez de apagar dados silenciosamente.

### 5. Executar via Session Pooler

Usar os parâmetros exibidos pelo Supabase em **Connect → Session pooler**. Não colocar senha na linha de comando nem em arquivo.

Exemplo para o projeto atual:

```powershell
$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
$replace = "<PASTA_DO_SNAPSHOT>\postgres-final-replace.sql"

$env:PGSSLMODE = "require"
$env:PGCONNECT_TIMEOUT = "15"

& $psql `
  -h "aws-0-sa-east-1.pooler.supabase.com" `
  -p 5432 `
  -U "postgres.yioetdcbgorunwgwuawg" `
  -d "postgres" `
  -W `
  -v ON_ERROR_STOP=1 `
  -f "$replace"
```

O prompt `Password:` recebe a **senha do banco do projeto Supabase**, não a senha da conta e não a service-role key.

Sucesso exige `COMMIT` no fim. Qualquer erro antes do `COMMIT` aborta a janela; mantenha writes congelados até diagnosticar ou efetuar rollback operacional.

### 6. Validar antes de liberar writes

Com a trava ainda em `1`:

- comparar as 22 contagens com o snapshot recém-gerado;
- executar `supabase/sql/validate_d1_import.sql`;
- confirmar zero órfãos e zero violações de negócio;
- confirmar IDs máximos e sequences;
- auditar permissões das RPCs;
- executar sanity checks das RPCs de leitura.

Não usar contagens históricas como critério; os valores autoritativos são os do snapshot desta janela.

### 7. Deploy B: candidato primário ainda congelado

Depois da validação completa, implantar:

```toml
SUPABASE_WRITE_MODE = "primary"
SUPABASE_CUTOVER_WRITE_FREEZE = "1"
SUPABASE_READS_ENABLED = "1"
```

Confirmar health checks e leituras do Scanner, cadastro, Catálogo e Mural. Toda falha de RPC primária deve produzir `technical_error=supabase_primary_write_failed`; ela nunca pode virar sucesso silencioso.

### 8. Liberar writes

Após os smoke tests congelados e o Production Gate verde, o release altera somente:

```toml
SUPABASE_CUTOVER_WRITE_FREEZE = "0"
```

As operações reais passam a gravar diretamente no Supabase. Cadastro/edição de produto também dispara sincronização NISTI → Commerce, e exclusão remove o vínculo de sincronização correspondente. O D1 permanece preservado na conta apenas para recuperação, mas não está mais conectado ao Worker de produção.

### 9. Estabilização após a escrita direta

Confirmar as primeiras operações reais no Supabase, acompanhar Saúde/Logs, sincronização do Catálogo e filas de imagem/referência. Não remover o binding D1 no mesmo deploy da liberação de escrita; a retirada física do D1 pertence a uma fase posterior, depois da janela de confiança.

## Semântica do fallback de leitura

Com `SUPABASE_READS_ENABLED=1` e `SUPABASE_EMERGENCY_FALLBACK_ENABLED=0`:

- resposta Supabase válida, inclusive `[]`, `false` ou `null`, é autoritativa;
- D1 não é consultado para mascarar dado ausente, divergente ou indisponibilidade do Supabase;
- timeout, erro de transporte, HTTP 429 e 5xx do Supabase falham fechado em produção;
- 401, 403, 404 e erro de configuração também falham fechado;
- o fallback D1 só pode ser reativado manualmente com `SUPABASE_EMERGENCY_FALLBACK_ENABLED=1` em uma operação controlada, depois de confirmar que o D1 foi ressincronizado e está consistente.

## Rollback

Depois da promoção do Supabase, o rollback padrão é de **código**, mantendo o Supabase como autoridade de dados.

Não trocar automaticamente leituras/escritas para o D1: as escritas diretas Supabase não mantêm o D1 atualizado, portanto ele pode estar defasado.

Um rollback de dados para D1 exige, nesta ordem:

1. congelar escritas;
2. gerar uma cópia consistente e atual do Supabase;
3. ressincronizar/validar o D1;
4. somente então alterar `SUPABASE_READS_ENABLED` ou `SUPABASE_WRITE_MODE`;
5. manter a troca fail-closed se a reconciliação não fechar.

Não excluir o banco D1 legado, R2 ou Vectorize durante a estabilização. O D1 permanece como artefato de recuperação desconectado do Worker; qualquer uso exige configuração explícita de compatibilidade e ressincronização.
