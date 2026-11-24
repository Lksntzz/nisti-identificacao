# GA-019 — publicar e reverter a importação de vendas por dia

Procedimento da PR #910 (`commerce_commit_sales_import_v2`). **Nada aqui foi executado em produção.** Só executar depois da aprovação do Lucas. Contexto das regras: [[importacao]]; regras de deploy: [[deploy]]; backup: [[backup]].

## Ordem obrigatória (e por quê)

1. Backup → 2. Segredo no Cloudflare → 3. Migração no Supabase → 4. Merge (o deploy sai sozinho) → 5. Validação → (6. Reversão, se precisar).

- **O merge dispara o deploy do código novo sozinho.** O código novo exige a migração e o segredo: sem a migração, as importações falham (a função v2 não existe); sem o segredo, a rota de pedidos recusa (erro 503, nada é gravado). Por isso o merge é o ÚLTIMO passo.
- **Janela de compatibilidade:** *migração aplicada + código atual (v1)* funciona (testado: a v1 continua importando, nenhum dado nem leitura muda). O contrário, *código novo + banco sem a migração*, NÃO funciona. Nunca inverta a ordem.
- Só os passos 3 e 4 mudam algo em produção que afete usuários. O passo 2 (segredo) o código atual ignora.

## 0. Antes de começar

- PR #910 com todos os checks verdes e **nenhum em andamento** ("skipped" não conta como terminado; o Commerce Preview aparece como *skipped* em qualquer branch fora das duas branches antigas dele, é esperado).
- Nenhuma importação de vendas em andamento (peça à equipe para não importar durante o procedimento, cerca de 30 minutos).
- No Supabase (SQL Editor) rode e anote o resultado:

<!-- sql:preflight -->
```sql
-- 1) alguém importando agora? (deve voltar vazio)
select pid, state, now() - xact_start as ha, left(query, 80) as consulta
from pg_stat_activity
where datname = current_database() and pid <> pg_backend_pid() and state <> 'idle'
  and query ~* 'commerce_(commit|append|activate)_';
-- 2) lotes de venda abertos (hoje existem 4 antigos parados: ids 8, 10, 77 e 78; são inofensivos, nunca foram confirmados)
select id, platform_code, status, source_filename, created_at
from commerce_sales_import_batches where status in ('UPLOADED', 'STAGED') order by id;
```

  Atenção: o lote 10 é a parte 1 de 2 de um arquivo de setembro da Shopee. **Não importe a parte 2 dele** (ela se juntaria ao lote antigo, que não tem os dados novos, e o commit falharia). Reexporte setembro inteiro se precisar.

### Checks obrigatórios na `main` (configuração única, no GitHub)

**Situação em 23/11/2026: a `main` NÃO tem nenhuma proteção** (nem regra clássica nem ruleset). Hoje nada impede mesclar com check vermelho ou em andamento, que já causou falha no Deploy Production. Passo a passo (só o dono do repositório consegue):

1. github.com/Lksntzz/nisti-identificacao → **Settings** → **Branches** → em "Branch protection rules" clique **Add classic branch protection rule**.
2. "Branch name pattern": `main`.
3. Marque **Require status checks to pass before merging**. Na caixa de busca que aparece, procure e clique em cada um: **`database`** e **`build`** (os dois do workflow Production Gate; só aparecem na busca se rodaram nos últimos dias, e rodaram na PR #910).
4. **Não** marque "Require branches to be up to date before merging" (obrigaria atualizar a branch a cada merge, sem ganho aqui).
5. **Não** exija o *Browser Smoke* (`Chromium UI interactions`) nem *Test, build and upload Worker preview*: o Browser Smoke só roda quando a PR muda arquivos de `src/`, `public/` etc.; numa PR só de documentação ele nunca aparece, e um check obrigatório que nunca aparece **trava o merge para sempre**. O `build` e o `database` rodam em toda PR.
6. Recomendado: marque **Do not allow bypassing the above settings**, senão você (dono) continua podendo mesclar com check vermelho. Custo: se o `database` quebrar por falha do próprio GitHub, não dá para mesclar até ele voltar ou até você desmarcar a regra (Settings → Branches → editar → desmarcar, e marcar de novo depois).
7. Clique **Create**. Não marque "Require a pull request", nem "Require approvals", nem "Restrict who can push": o fluxo atual (branch → PR → squash) já passa por PR e esses itens só criariam bloqueios novos.
8. Conferência: abra uma PR qualquer (a #910 serve): no fim da página, os checks `build` e `database` devem aparecer com a etiqueta **Required** e o botão de merge fica desabilitado enquanto algum estiver em andamento ou vermelho. A conferência por API, que eu faço depois: `gh api repos/Lksntzz/nisti-identificacao/branches/main/protection`.

Como funciona: a trava atua **antes** do merge. O GitHub bloqueia o botão enquanto `build` ou `database` estiverem em andamento ou vermelhos, o que impede o erro já vivido de mesclar antes de os checks terminarem.

## 1. Backup

1. Painel do Supabase → Database → Backups: anote se existe algum backup do próprio Supabase (o plano gratuito normalmente não tem). **Decisão do dono (24/11/2026): publicar sem o backup externo; ele ficou como pendência de infraestrutura** ([[backup]]). Quando for feito, siga o passo a passo e **teste a restauração num PostgreSQL isolado** (seção "Teste de restauração" de [[backup]]). Sem ele, a única proteção é a cópia interna do item 2, que mora no mesmo banco: serve para desfazer a GA-019, não para perder o projeto. O banco tem cerca de 202 MB (217 MB com a cópia interna do item 2); o limite padrão do script agora é 300 MB, então não precisa mexer em nenhuma variável. Se o banco passar de 300 MB, o script recusa de propósito: confira a franquia de rede (plano gratuito: 5 GB por mês; o backup transfere algo como o tamanho do banco) e só então use `NISTI_BACKUP_MAX_MB` (até 500). Guarde a senha de criptografia fora do Drive.

   Para comparar o banco com o banco restaurado, rode isto no SQL Editor **logo antes e logo depois do backup** (os dois resultados têm de ser iguais; se forem diferentes, alguém mexeu no sistema durante o backup e a comparação com o banco restaurado precisa ser feita tabela a tabela):

<!-- sql:restore-signature -->
```sql
select count(*) as tabelas, sum(linhas) as total_de_linhas,
  md5(string_agg(tabela || ':' || linhas, ',' order by tabela)) as assinatura
from (
  select table_name::text as tabela,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', table_name), false, true, '')))[1]::text::bigint as linhas
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'
) t;
```

   O mesmo comando, rodado no banco restaurado (com `psql`), tem de devolver a **mesma assinatura**. Ela só compara contagens de linhas das tabelas do `public`; não prova o conteúdo de cada linha.
2. **Cópia interna das tabelas de vendas que a v2 pode alterar** (cerca de 20 MB, grátis, dentro do limite de 500 MB; o backup semanal automático do projeto NÃO cobre estas tabelas). Rode no SQL Editor:

<!-- sql:backup -->
```sql
create schema if not exists backup;
create table backup.pre_ga019__commerce_sales_snapshots as select * from public.commerce_sales_snapshots;
create table backup.pre_ga019__commerce_sales_import_batches as select * from public.commerce_sales_import_batches;
create table backup.pre_ga019__commerce_sales_summary_rows as select * from public.commerce_sales_summary_rows;
create table backup.pre_ga019__commerce_sales_import_stage_summary as select * from public.commerce_sales_import_stage_summary;
create table backup.pre_ga019__commerce_sales_listing_daily_v1 as select * from public.commerce_sales_listing_daily_v1;
create table backup.pre_ga019__commerce_shopee_sales_sku_daily_v1 as select * from public.commerce_shopee_sales_sku_daily_v1;
create table backup.pre_ga019__commerce_shopee_sku_daily_superseded_v1 as select * from public.commerce_shopee_sku_daily_superseded_v1;
create table backup.pre_ga019__commerce_shopee_fin_daily_superseded_v1 as select * from public.commerce_shopee_fin_daily_superseded_v1;
create table backup.pre_ga019__commerce_shopee_finance_daily_v1 as select * from public.commerce_shopee_finance_daily_v1;
create table backup.pre_ga019__commerce_shopee_finance_month_v1 as select * from public.commerce_shopee_finance_month_v1;
create table backup.pre_ga019__commerce_shopee_full_daily_v1 as select * from public.commerce_shopee_full_daily_v1;
create table backup.pre_ga019__commerce_shopee_order_extras_daily_v1 as select * from public.commerce_shopee_order_extras_daily_v1;
revoke all on all tables in schema backup from public, anon, authenticated;
```

   Conferência (as colunas `igual` — mesma contagem — e `conteudo_igual` — mesmo conteúdo, linha a linha — devem ser `true` em todas as linhas; `conteudo_igual` é a que prova que a cópia ainda vale, porque pega alteração que não muda a contagem):

<!-- sql:backup-check -->
```sql
select t.nome,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', t.nome), false, true, '')))[1]::text::bigint as original,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) n from backup.%I', 'pre_ga019__' || t.nome), false, true, '')))[1]::text::bigint as copia,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) n from public.%I', t.nome), false, true, '')))[1]::text::bigint
   = (xpath('/row/n/text()', query_to_xml(format('select count(*) n from backup.%I', 'pre_ga019__' || t.nome), false, true, '')))[1]::text::bigint as igual,
  (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(to_jsonb(x)::text, %L order by to_jsonb(x)::text), %L)) h from public.%I x', '', '', t.nome), false, true, '')))[1]::text
   = (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(to_jsonb(x)::text, %L order by to_jsonb(x)::text), %L)) h from backup.%I x', '', '', 'pre_ga019__' || t.nome), false, true, '')))[1]::text as conteudo_igual
from unnest(array['commerce_sales_snapshots', 'commerce_sales_import_batches', 'commerce_sales_summary_rows', 'commerce_sales_import_stage_summary',
  'commerce_sales_listing_daily_v1', 'commerce_shopee_sales_sku_daily_v1', 'commerce_shopee_sku_daily_superseded_v1', 'commerce_shopee_fin_daily_superseded_v1',
  'commerce_shopee_finance_daily_v1', 'commerce_shopee_finance_month_v1', 'commerce_shopee_full_daily_v1', 'commerce_shopee_order_extras_daily_v1']) as t(nome);
```

   A tabela grande `commerce_sales_rows` (68 MB) não entra: a v2 só INSERE nela (linhas de snapshots novos), nunca altera as antigas. Estas cópias ficam até a validação terminar; só apague depois de o Lucas confirmar (nome `backup.pre_ga019__*`). A limpeza semanal automática do banco (`backup.take_snapshot_v1`) só apaga tabelas `s<número>__*`, então não toca nelas.

   **A cópia é uma foto do momento em que foi feita.** Se a equipe importar vendas depois dela, a cópia fica velha. Por isso, no dia da publicação, rode de novo a conferência acima: se `conteudo_igual` vier `true` nas 12 linhas, nada mudou nessas tabelas desde a cópia e ela continua valendo. Se alguma vier `false`, a cópia está desatualizada e é preciso criar outra (com outro prefixo, para não sobrescrever esta) antes da migração. **Não use `versao_do_cache` para isso**: ela inclui a data de hoje e muda todo dia, mesmo sem nenhuma importação.
3. **Linha de base** (anote ou salve o resultado; serve para comparar depois):

<!-- sql:baseline -->
```sql
select s.id as snapshot_atual, (select max(id) from commerce_sales_snapshots) as maior_snapshot, (select max(id) from commerce_sales_import_batches) as maior_lote, public.commerce_data_version_v1() as versao_do_cache from commerce_sales_snapshots s where s.is_current;
select r.platform_code, to_char(r.period_start, 'YYYY-MM') as mes, sum(r.units) as unidades, round(sum(r.product_revenue), 2) as receita, sum(r.net_orders) as pedidos
from commerce_sales_summary_rows r join commerce_sales_snapshots s on s.id = r.snapshot_id and s.is_current
group by 1, 2 order by 1, 2;
```

## 2. Segredo do HMAC (Cloudflare)

1. Gerar o segredo no seu computador (PowerShell; NÃO use `Get-Random`, ele não é seguro):

```powershell
$b = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)
```

   Para o valor **não aparecer na tela nem no histórico do PowerShell**, termine o último comando com ` | Set-Clipboard` (ele copia direto para a área de transferência):

```powershell
$b = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b) | Set-Clipboard
```

   O valor (64 caracteres) é o segredo. **Primeiro** cole no gerenciador de senhas (nome: "NISTI - COMMERCE_ORDER_KEY_SECRET"), **fora do Drive e fora do repositório** (que é público); só depois cadastre na Cloudflare. Nunca cole no chat. Se perder o valor, veja a seção 7. Terminado o passo 2, limpe a área de transferência: `Set-Clipboard -Value " "`.
2. Cloudflare → Workers & Pages → `nisti-identificacao` → Settings → **Variables and Secrets** → Add → tipo **Secret** (não "Text": variáveis de texto criadas no painel podem ser apagadas num deploy, secrets não) → nome exato `COMMERCE_ORDER_KEY_SECRET` (maiúsculas, com sublinhados, sem espaço no começo ou no fim) → colar o valor → Deploy/Save.
3. O código atual ignora esse segredo, então nada muda para ninguém. Se o painel pedir para "deploy", confirme (cria uma versão igual à atual; o Worker já roda com `nodejs_compat`, que o HMAC exige).
4. Conferência: na lista de "Variables and Secrets" deve aparecer `COMMERCE_ORDER_KEY_SECRET` com o tipo **Secret** e o valor escondido ("Value encrypted"). Não deve existir outra linha com o mesmo nome como "Text". O painel não mostra o valor de volta (de propósito); a prova de que o código o enxerga vem na validação do passo 5: sem o segredo a rota recusa com erro 503 `order_key_secret_missing` e nada é gravado.

## 3. Migração no Supabase

1. Pegue o arquivo `supabase/migrations/20261123210000_commerce_commit_sales_import_v2.sql` **do commit aprovado da PR** (confira o SHA-256 informado no relatório de aprovação) e aplique do mesmo jeito que as migrações anteriores. Ela roda numa transação: se der erro, **nada** é alterado.
2. Ela espera até 10 s pelos bloqueios das tabelas. Se alguma importação estiver rodando, ou ela termina primeiro ou a migração desiste inteira com erro de *lock timeout* (nada alterado): espere a importação acabar e rode de novo (é repetível).
3. Conferir depois:

<!-- sql:postcheck -->
```sql
select pg_get_functiondef('public.commerce_commit_sales_import_v1(bigint)'::regprocedure) like '%commerce_sales_commit%' as v1_com_trava;   -- true
select count(*) as gatilhos_de_exclusao from pg_trigger where tgname like 'commerce_sales_delete_guard%';                                      -- 2
select count(*) as funcoes_v2 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('commerce_commit_sales_import_v2', 'commerce_append_sales_import_orders_v2', 'commerce_set_sales_import_meta_v2',
   'commerce_activate_shopee_finance_v2', 'commerce_rollback_sales_import_v2', 'commerce_sales_reconcile_v2');                                    -- 6
select * from commerce_sales_reconcile_v2() where not ok;   -- ver abaixo
```

   A última consulta lista meses em que o resumo não bate com o detalhe diário. **Já existem meses assim ANTES da GA-019** (outubro e novembro de 2026, em todas as plataformas): anote a lista como linha de base, não é defeito da migração. Eles só desaparecem quando o mês é reimportado inteiro pela v2.
4. Abra o GA (Dashboard): deve carregar normalmente, com os mesmos números da linha de base.

## 4. Merge e deploy

1. Tire a PR do rascunho (botão "Ready for review") só depois dos passos 1 a 3 e da sua aprovação.
2. Confirme que **todos** os checks (Production Gate com o job `database`, Browser Smoke) estão verdes e sem nenhum em andamento. O check `database` deve estar como obrigatório na `main` (configuração única, feita na seção "Checks obrigatórios" abaixo).
3. Merge com **squash**. Espere o workflow **Deploy Production do commit do merge** terminar com sucesso.

## 5. Validação funcional

1. Reexporte o **mês inteiro de outubro da Shopee** e importe. A mensagem deve dizer "Vendas importadas", listar `Meses recalculados: 2026-10` e, se houver, os dias sem registro (aviso, não erro).
2. Rode `select * from commerce_sales_reconcile_v2() where platform_code = 'SHOPEE';` → outubro com `ok = true`. Compare unidades e faturamento de outubro com o relatório da própria Shopee.
3. O financeiro mensal da Shopee de outubro deve aparecer (arquivo do mês inteiro). Depois do arquivo de novembro (incremental), novembro some do financeiro MENSAL até importar novembro inteiro; é o comportamento esperado ([[importacao]]).
4. Repita para novembro, e depois para o Mercado Livre (um dia dividido em partes deve aparecer inteiro).
5. Erros esperados e o que fazem: 503 `order_key_secret_missing` (segredo não cadastrado: nada gravado), 409 `sales_import_platform_mismatch`, `..._generated_at_required`, `..._orders_unresolved` etc. Todos desfazem tudo.
6. Só então avise a equipe que pode importar normalmente.

## 6. Reversão

**Nível A, antes do merge:** nada a fazer. O código atual funciona com a migração aplicada.

**Nível B, código novo com problema, sem nenhuma importação v2 confirmada:** volte o código. Cloudflare → Workers & Pages → `nisti-identificacao` → Deployments → versão anterior → Rollback (ou reverta o commit do merge na `main`; o Deploy Production publica a versão antiga). Não precisa de variável de ambiente. A migração fica (é inofensiva: só adiciona).

**Nível C, uma importação v2 saiu errada:** desfaça o ÚLTIMO commit (só o mais recente pode ser desfeito, uma vez):

<!-- sql:rollback-find -->
```sql
select snapshot_id, platform_code, batch_ids, committed_at, rolled_back_at
from commerce_sales_commit_log_v2 order by snapshot_id desc limit 5;
```

```sql
select public.commerce_rollback_sales_import_v2(NUMERO_DO_SNAPSHOT);
```

Isso restaura os resumos do snapshot anterior, os dias que foram trocados, o Full diário, o financeiro (mês e dia) e limpa o cache; o lote vira `FAILED`. Para voltar mais de uma importação, repita com o novo "último" (do mais recente para o mais antigo). Depois confira `commerce_sales_reconcile_v2()` e o Dashboard. Se mesmo assim precisar voltar o código, faça o Nível B: a v1 funciona com os dados restaurados (testado).

**Nível D, depois de uma importação com a v1 no meio:** se alguém importar pelo código antigo depois de importações v2, o último commit passa a ser da v1 e a reversão automática recusa (`sales_import_rollback_not_current`). Evite importar enquanto o código estiver revertido sem avisar quem desfez; se acontecer, a recuperação é feita com ajuda a partir das cópias `backup.pre_ga019__*`, nunca restaurando por cima sem conferir.

**A migração em si não tem "desfazer"**: ela só adiciona tabelas, funções e gatilhos, e substitui a view `commerce_current_sales_listing_daily_v1` (resultado igual hoje; confirmado em 654 dias de ML) e a função v1 (só ganha a trava). Se for necessário voltar a view antiga (reintroduz o descarte de partes do mesmo dia do Mercado Livre), a definição anterior está em `test/db/fixtures/old-ml-view.sql`; peça ajuda antes.

## 7. Segredo do HMAC: troca, perda e comprometimento

**O que a chave faz:** serve só para contar pedidos únicos. O banco guarda, por dia, a chave de cada pedido (nunca o número). Os números do mês já confirmado ficam gravados no resumo; as chaves só são relidas quando o mês é reconstruído.

**Efeitos de trocar o segredo (testado em `test/db/commerce-sales-import-v2-publication.db.test.js`):**
- Pedidos históricos e meses já confirmados: **não mudam**. As chaves antigas continuam guardadas, não são recalculadas.
- Importar dias novos depois da troca: soma exata (dias antigos com chaves antigas + dias novos com chaves novas; um pedido pertence a um único dia).
- Reimportar um dia já importado depois da troca: o lote novo **substitui o dia inteiro**, então as chaves antigas desse dia deixam de contar. Nada é contado em dobro.
- **Único risco real:** arquivo em partes (`..._part_1_of_2.xlsx`, `..._part_2_of_2.xlsx`) enviado ANTES e DEPOIS da troca. Um pedido com itens nas duas partes é contado duas vezes (as chaves das duas partes não se encontram). Por isso: **nunca troque o segredo com partes pendentes** (consulta "preflight" acima: se houver lote `STAGED`/`UPLOADED` de um arquivo em partes, termine a importação ou reexporte o arquivo inteiro antes).

**Segredo perdido (sumiu, mas não vazou):** cadastre um novo no Cloudflare (mesmos passos do item 2). Sem o segredo as importações de vendas ficam recusadas (503) até cadastrar; nada é gravado. Efeitos = troca (acima). Não é preciso mexer nos dados.

**Segredo comprometido (vazou):** o que um vazamento permite: quem tiver o segredo E uma cópia do banco consegue conferir se um número de pedido específico está lá (nunca descobre comprador, nome, valor ou endereço: o banco não tem isso nas chaves). Procedimento:
1. Gere e cadastre um segredo novo (item 2) e confirme que não há arquivo em partes pendente.
2. Reexporte e importe, com o segredo novo, **todos os meses que você quer proteger** (cada reimportação substitui as chaves do mês).
3. Só depois, confira quantas chaves antigas já não sustentam nenhum dia:

<!-- sql:superseded-count -->
```sql
with vencedores as (
  select distinct w.batch_id, w.sale_date
  from (values ('SHOPEE'), ('ML_NOVO'), ('ML_ANTIGO')) p(platform_code),
  lateral public.commerce_sales_day_winners_v2(p.platform_code, date '2000-01-01', date '2100-01-01') w)
select count(*) as chaves_antigas
from public.commerce_sales_import_stage_orders_v2 o
where not exists (select 1 from vencedores w where w.batch_id = o.batch_id and w.sale_date = o.sale_date);
```

4. Faça o backup do item 1 e apague **só essas**:

<!-- sql:superseded-delete -->
```sql
with vencedores as (
  select distinct w.batch_id, w.sale_date
  from (values ('SHOPEE'), ('ML_NOVO'), ('ML_ANTIGO')) p(platform_code),
  lateral public.commerce_sales_day_winners_v2(p.platform_code, date '2000-01-01', date '2100-01-01') w)
delete from public.commerce_sales_import_stage_orders_v2 o
where not exists (select 1 from vencedores w where w.batch_id = o.batch_id and w.sale_date = o.sale_date);
```

   **Nunca apague chaves de dias que ainda valem:** o próximo commit do mês recusa (`sales_import_orders_unresolved`, tipo `V2_DAY_WITHOUT_KEYS`) em vez de contar pedidos a menos, e nada é alterado; mas é erro seu a corrigir reimportando o mês.
5. Meses que você NÃO reimportar continuam com chaves do segredo antigo (continuam "expostas" ao vazamento). O que protege de fato é o segredo antigo deixar de existir e o banco não vazar; avalie reimportar o que for sensível.

## Itens que continuam em aberto

- Data de geração do arquivo = data de modificação do arquivo no computador (copiar, extrair ou baixar de novo pode alterá-la).
- Uma proteção extra opcional, **não implementada** para não ampliar a GA-019: gravar uma "impressão digital" do segredo em cada lote para recusar partes do mesmo arquivo com segredos diferentes. Só vale a pena se trocas de segredo se tornarem frequentes.
