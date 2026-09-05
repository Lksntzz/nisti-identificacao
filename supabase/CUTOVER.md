# NISTI ID — Cutover D1 → Supabase

## Estado padrão

O repositório mantém o Supabase preparado, mas sem cutover ativo:

```text
SUPABASE_URL=https://yioetdcbgorunwgwuawg.supabase.co
SUPABASE_READS_ENABLED=0
SUPABASE_READ_TIMEOUT_MS=2500
SUPABASE_WRITE_MODE=off
SUPABASE_CUTOVER_WRITE_FREEZE=0
```

`SUPABASE_SERVICE_ROLE_KEY` **não** pode ser versionada. Ela deve existir apenas como segredo server-side do Cloudflare Worker.

## Invariantes de segurança

- D1 continua sendo a autoridade até a conclusão explícita do cutover.
- O navegador nunca recebe a service-role key nem acessa o PostgreSQL diretamente.
- Não alterar thresholds de reconhecimento durante o cutover.
- Não importar `push_logs`; essa tabela permanece legado/diagnóstico fora da autoridade PostgreSQL.
- Não aplicar a migration não mergeada `0014_ambiguous_review_candidates.sql` como parte deste procedimento.
- `postgres-data.sql` é um arquivo de carga inicial. Para a substituição final use **somente** `postgres-final-replace.sql` gerado pelo script NISTI.
- Nunca executar o replace final sem a trava de escrita confirmada em produção.

## Pré-requisitos

Todos os itens abaixo são obrigatórios antes da janela final:

1. schema e RPCs Supabase aplicados e auditados como `SECURITY INVOKER`;
2. `PUBLIC`, `anon` e `authenticated` sem `EXECUTE` nas RPCs privilegiadas;
3. `service_role` com `EXECUTE` nas RPCs necessárias;
4. snapshot inicial importado e validado;
5. Production Gate verde na versão a ser implantada;
6. `SUPABASE_SERVICE_ROLE_KEY` configurada no Worker;
7. Phase 6 de write mirroring concluída no código;
8. ferramenta `scripts/build-supabase-final-replace.mjs` presente;
9. `SUPABASE_READS_ENABLED=0` durante toda a sincronização final.

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
- faz `TRUNCATE` exatamente das 13 tabelas autoritativas;
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

- comparar as 13 contagens com o snapshot recém-gerado;
- executar `supabase/sql/validate_d1_import.sql`;
- confirmar zero órfãos e zero violações de negócio;
- confirmar IDs máximos e sequences;
- auditar permissões das RPCs;
- executar sanity checks das RPCs de leitura.

Não usar contagens históricas como critério; os valores autoritativos são os do snapshot desta janela.

### 7. Deploy B: liberar writes com mirror ativo

Somente depois da validação completa, alterar:

```toml
SUPABASE_WRITE_MODE = "mirror"
SUPABASE_CUTOVER_WRITE_FREEZE = "0"
SUPABASE_READS_ENABLED = "0"
```

Neste ponto D1 continua autoridade, mas novas escritas passam a ser espelhadas no Supabase.

### 8. Validar mirroring em produção

Executar operações reais/controladas que cubram os writers relevantes e confirmar que o estado correspondente aparece no Supabase sem divergência. Falha de mirror não pode ser ignorada antes do read cutover.

### 9. Read cutover — somente após paridade pós-freeze

Apenas quando houver evidência de que as escritas posteriores ao Deploy B permanecem sincronizadas, criar deploy específico alterando somente:

```toml
SUPABASE_READS_ENABLED = "1"
```

`SUPABASE_WRITE_MODE` deve continuar em `mirror` enquanto D1 ainda for mantido como rollback operacional.

## Semântica do fallback de leitura

Com `SUPABASE_READS_ENABLED=1`:

- resposta Supabase válida, inclusive `[]`, `false` ou `null`, é autoritativa;
- D1 não é consultado para mascarar dado ausente/divergente;
- fallback D1 temporário ocorre somente em timeout, erro de transporte, HTTP 429 ou 5xx;
- 401, 403, 404 e erro de configuração falham fechado para tornar problemas de cutover visíveis.

## Rollback

Antes do read cutover, rollback é simplesmente manter:

```toml
SUPABASE_READS_ENABLED = "0"
```

Depois de reads habilitados, o rollback operacional volta reads para D1:

```toml
SUPABASE_READS_ENABLED = "0"
SUPABASE_WRITE_MODE = "mirror"
```

Não excluir o D1, R2 ou Vectorize durante a estabilização. A remoção do D1 só pode ser considerada em uma fase posterior, após escrita primária Supabase, observabilidade e rollback terem sido validados independentemente.
