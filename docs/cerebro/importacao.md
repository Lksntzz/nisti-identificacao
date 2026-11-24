# Importação de planilhas (Shopee e Mercado Livre)

Botão **Importar arquivo** do Painel Comercial (GA). Vendas, catálogo e relatórios chegam por planilha `.xlsx`; não há API dos marketplaces. Contexto geral: [[ga]]. Detalhe de tabelas e funções: seção 4 do [[MAPA-GA]].

## Tipos de importação

Registro único em `src/ga/commerce-import-options.js` (alimenta o menu e a tela de envio). Cada tipo tem leitor, tela e função SQL próprios:

- **Produtos e anúncios** (catálogo por plataforma): lote em etapas (criar lote → linhas → conciliar → aprovar → commit). Rotas `/imports/...`.
- **Vendas**: o foco desta nota. Rotas `/sales/imports/...`.
- **Shopee Ads, Desempenho (Shopee e ML) e Pós-venda Shopee**: relatórios **isolados**. Nunca alteram vendas, pedidos nem SKUs.

## Caminho das vendas

1. **O navegador lê a planilha** (`read-excel-file/browser`, em `commerce-sales-import-reader.js`). O servidor não recebe o arquivo: recebe os dados já lidos, em partes.
2. `src/ga/commerce-import-client.js` envia JSON em pedaços (lotes de linhas), nesta ordem: criar lote → `rows` → `summary` → **`meta`** (data de geração do arquivo) → **`orders`** (referências dos pedidos por dia; o servidor as transforma em HMAC) → `listing-daily` (vendas por anúncio por dia) → `sku-daily` (Shopee) → `finance-month` → `finance-daily` → `shopee-full` → **`commit`**. O `commit` é o último passo. **Desde a GA-019 `rows` e `summary` são POR DIA** (`period_key` = data real do pedido), não por mês.
3. Funções SQL `commerce_create_sales_import_v1`, `commerce_append_*` (+ `commerce_append_sales_import_orders_v2`) e **`commerce_commit_sales_import_v2`** (a `_v1` continua no banco só para reversão e não é mais chamada pelo código), chamadas por `commerce-supabase-store.js`. Dados vão para `commerce_sales_listing_daily_v1` e, na Shopee, `commerce_shopee_sales_sku_daily_v1`, que alimentam a view `commerce_current_sales_listing_daily_v1` (usada por todas as telas de vendas).
4. Excluir uma importação errada: tela **Histórico de importações** (`commerce_delete_import_batch_v1`).

## Regras da Shopee

- **Confirmado = status válido E hora do pagamento preenchida.** Status aceitos: concluído, entregue, enviado, a enviar, pedido recebido e "o comprador pode pedir uma devolução até …". Cancelados, reembolsados e devolvidos ficam fora.
- A planilha **precisa** ter "Status do pedido" e "Hora do pagamento do pedido"; sem elas a importação é recusada (não importa em silêncio).
- **Receita do item = "Subtotal do produto"**, nunca o valor total do pedido. O SKU vem de "Número de referência SKU" (o SKU principal é "Nº de referência do SKU principal").
- **Full** = coluna "Pedido FBS" = Yes **ou** "Opção de envio" = Full. Guardado por dia e SKU (`commerce_shopee_full_daily_v1`) e usado no card Full x envio próprio do Dashboard.
- O financeiro (desconto do vendedor, taxa de transação, comissão, serviço) é somado por dia e por mês.
- **Extras do pedido** (06/11/2026): `commerce-shopee-order-extras.js` resume por dia e SKU o preço original e o acordado (média ponderada, mínimo e máximo), cancelados com motivo (só estatística; continuam fora das vendas), frete estimado e pago pelo comprador, cashback do vendedor e unidades por UF. Frete e cashback são do pedido inteiro, então só entram em pedido de um único SKU. Vai em `shopee-extras` para `commerce_shopee_order_extras_daily_v1`; um lote de snapshot mais novo substitui os mesmos dias (gatilho `commerce_shopee_supersede_old_days_v1`). Ainda não há tela que leia esses dados.

## Regras do Mercado Livre

- Relatório oficial **"Vendas BR"**: cabeçalho numa linha mais abaixo (depois de linhas de metadados), datas em formato brasileiro, e linhas extras de **resumo de pacote** ("Pacote de N produtos") que **não podem ser somadas** de novo.
- O pacote é conferido: o valor da linha-pai tem que bater com os itens filhos. Se não bater, a importação é **bloqueada** com a linha do problema, em vez de aceitar um faturamento errado.
- Linhas canceladas, devolvidas, trocadas, recusadas ou "não entregue" são ignoradas. Data inválida ou quantidade inválida também bloqueiam.
- ML Novo e ML Antigo são contas diferentes: o usuário escolhe a plataforma ao importar.

## Reimportação e períodos

- **Reimportar um dia substitui o antigo** (gatilho `commerce_shopee_supersede_old_days_trg`): o lote mais novo substitui os mesmos dias de snapshots mais antigos, e o antigo é removido. O gatilho (versão atual, migração `20261031000500_commerce_shopee_full_daily_import_v1.sql`) age em **três** tabelas: vendas por SKU/dia e financeiro por dia, que guardam o que saiu em `*_superseded` (dá para desfazer), e o **Full por dia** (`commerce_shopee_full_daily_v1`), que é **apagado sem cópia**. Só vale para a Shopee e só quando o lote novo tem `snapshot_id` maior. Os dias comparados vêm das vendas por SKU do lote novo. Arquivos do mesmo snapshot **somam**; não substituem.
- **Commit por dia (GA-019, `commerce_commit_sales_import_v2`)** — substitui a regra antiga "o arquivo troca o mês inteiro da plataforma", que apagava os dias anteriores quando o arquivo trazia só dias novos (BUG-GA-001: outubro/novembro de 2026 ficaram com resumo menor que o detalhe diário).
  - **Cobertura = só dias COM registro.** Dia dentro do período do arquivo sem nenhuma linha é **"sem registro"**, nunca "sem vendas": arquivo filtrado ou incompleto pode omitir datas. Esses dias não apagam nem zeram nada, não entram na cobertura (`commerce_sales_day_coverage_v2` só tem dias com venda) e voltam no resultado do commit em `days_without_records`. A tela do histórico diz "dia(s) sem registro". A chave SQL `days_without_sales` do histórico (`sales_import_history_v1`) ficou com o nome antigo só para não mexer em função existente.
  - **Data de geração do arquivo é obrigatória** (`lastModified` do arquivo, enviada em `POST /sales/imports/:id/meta` → `commerce_set_sales_import_meta_v2`; limitada ao momento do envio; sem ela o commit falha com `sales_import_generated_at_required`). Ela decide se o **último dia** do arquivo está completo (arquivo gerado depois do fim desse dia, fuso America/Sao_Paulo) e protege contra relatório antigo.
  - **Por dia, vence o lote de snapshot mais novo** (mesma regra do gatilho e das views), com duas proteções que mantêm o dia já salvo e aparecem em `kept_days` com o motivo: `PARTIAL_DAY` (dia parcial não substitui dia completo) e `STALE_FILE` (arquivo **gerado antes** do que já foi importado para aquele dia não o substitui: relatório antigo não derruba dado atualizado). Reimportar o mesmo arquivo/dia continua permitido (substitui por igual ou mais novo).
  - Os **meses tocados são reconstruídos** a partir de todos os dias vencedores (`commerce_sales_day_rows_v2`); plataformas e meses não tocados são copiados do snapshot anterior. Dentro da mesma transação o commit **concilia** o resumo do mês com a fonte diária (`commerce_sales_daily_source_v2`: unidades exatas, receita ±0,05) e falha com `sales_import_reconciliation_failed` se não bater. Conferência a qualquer momento: `select * from commerce_sales_reconcile_v2();` (todas as linhas devem ter `ok = true`).
  - **Mercado Livre:** quando o mesmo dia vem em várias partes (lotes) do MESMO snapshot, a view `commerce_current_sales_listing_daily_v1` agora **soma todas as partes do snapshot mais novo** do dia (antes mantinha só uma e descartava vendas). Mesmas colunas e tipos; conferida igual à view antiga em produção quando não há dia em partes. Dia em snapshot mais novo continua substituindo o antigo por inteiro.
  - **Pedidos únicos** = chaves distintas por dia em `commerce_sales_import_stage_orders_v2` (inclusive entre partes do mesmo arquivo). Nunca a soma de `orders_with_item` por SKU. Mês antigo (legado) sem chaves só tem pedido exato se o arquivo legado foi um bloco único e nenhum dia dele foi trocado; senão o commit **falha** com `sales_import_orders_unresolved` (reexportar o mês inteiro). Não se estima.
  - **Identificação dos pedidos = HMAC-SHA256 com segredo só no servidor** (`src/ga/commerce-order-keys.js`). O navegador só repassa (dia + número do pedido) por HTTPS; a rota `POST /sales/imports/:id/orders` (até 500 por chamada) calcula `HMAC-SHA256(segredo, "nisti-order-v2|PLATAFORMA|número")` (32 primeiros hex) e envia ao banco **só a chave**. O número real não é gravado, devolvido nem escrito em log. O segredo é o *secret* do Worker **`COMMERCE_ORDER_KEY_SECRET`** (mínimo 32 caracteres; nunca no repositório, no `wrangler.toml` nem no navegador). **Sem o segredo a rota falha fechada** (503 `order_key_secret_missing`, nada é gravado). Quem vazar só o banco não consegue conferir se um número de pedido existe lá (um hash sem chave permitiria). **A plataforma usada no HMAC tem que ser a do lote:** o Worker manda `p_platform` junto das chaves e `commerce_append_sales_import_orders_v2` compara com a plataforma cadastrada no lote; se for diferente recusa com `sales_import_platform_mismatch` e não grava nada (a chave inclui a plataforma, então uma chave gerada com outra plataforma nunca bateria com a do mesmo pedido em outro arquivo). **Trocar o segredo:** meses já confirmados e pedidos históricos não mudam (as chaves antigas ficam guardadas e não são recalculadas); dias novos entram exatos; reimportar um dia substitui as chaves dele inteiras (nenhum pedido em dobro). Único risco: arquivo em partes enviado antes e depois da troca (pedido com itens nas duas partes conta em dobro), então não trocar com partes pendentes. Perda, troca e comprometimento do segredo, com os comandos: [[ga-019-publicacao]], seção 7. Dia da v2 sem nenhuma chave (apagada à mão) faz o commit recusar (`sales_import_orders_unresolved`, `V2_DAY_WITHOUT_KEYS`) em vez de contar pedidos a menos. Custo: ~3 µs por pedido (HMAC síncrono do Node, `nodejs_compat`), cabe nos 10 ms de CPU do plano gratuito.
  - **Trava global**: `pg_advisory_xact_lock(hashtextextended('commerce_sales_commit',2026))` na v2, na reversão e (a migração insere a linha) na v1, então nem a v1 nem a v2 montam snapshot ao mesmo tempo. A ativação financeira usa a trava `(2026,2987)`. A migração falha alto (`v1_lock_patch_pattern_not_found`) se a v1 em produção mudou de formato.
  - **Atômico**: tudo numa transação; qualquer erro desfaz tudo (lote continua `STAGED`, nenhum snapshot novo). O cache (`commerce_data_version_v1`) só muda quando um lote vira `COMMITTED`.
  - **Exclusão bloqueada:** lote `COMMITTED` processado pela v2 (e o snapshot dele) **não pode ser excluído** (gatilhos `BEFORE DELETE`; a tela devolve `sales_import_delete_blocked_v2`), porque deixaria os resumos inconsistentes. Para desfazer use a reversão. Manutenção deliberada (só por quem tem acesso ao SQL e depois de backup): na mesma transação `set local nisti.allow_sales_delete = 'on';`.
  - **`Order.toship`** (pedidos para enviar) é recusado no leitor, na rota de criar lote e no banco (`sales_import_toship_blocked`) até a finalidade do arquivo ser validada.
  - O leitor exige **data e ID do pedido em toda linha** (senão para). O número do pedido só existe em `order_refs`, que vai ao servidor e nunca é guardado.
  - **Financeiro Shopee (ponto de atenção):** `commerce_activate_shopee_finance_v2` grava o diário sempre (só dos dias que o lote aplicou) e o **mensal só quando todos os dias do mês pertencem ao mesmo arquivo**. A view `commerce_shopee_finance_current_month_v1` (NÃO alterada, nenhum indicador removido) só mostra o mês quando o snapshot do mês é o do último lote Shopee que o tocou. Efeito: depois de um arquivo **incremental** (poucos dias), o financeiro **mensal** daquele mês some até um arquivo do mês inteiro ser importado; vendas e financeiro diário continuam. Isso já era o comportamento da view; a v2 só o torna visível. Meses mistos vêm em `finance_months_mixed_not_published`; a view `commerce_shopee_finance_month_visibility_v2` lista o motivo por mês. Outubro e novembro da Shopee serão reexportados inteiros, o que restaura o mensal. Mudar essa política (mostrar mês parcial) exige aprovação.
  - Importar um mês **antigo** que o detalhe diário não reproduz falha com `sales_import_month_not_rebuildable` (reexportar o mês inteiro).
  - **Mercado Livre — receita em branco no relatório (24/11/2026):** o relatório "Vendas BR" pode sair incompleto (aviso "Não foi possível exibir alguns dados" no cabeçalho) com receita vazia em vendas fora de pacote; o leitor bloqueia ("Receita do produto ausente e sem pacote verificável na linha N") e **não estima**. Correção: reexportar o relatório. Filhos de pacote ("Pacote de N produtos") têm a receita recuperada pela conferência de soma. Melhorias de classificação e de exibição de todas as inconsistências: proposta GA-020 (não implementada).
  - **Publicação e reversão passo a passo** (backup, segredo, migração, merge, validação): [[ga-019-publicacao]]. A migração espera no máximo 10 s pelos bloqueios (`lock_timeout`) e, se não conseguir, desiste inteira sem alterar nada; com o GA atual (v1) em uso ela é compatível (testado: nenhum dado nem leitura muda, a v1 continua importando).
  - **Reversão** (sem chave de ambiente):
    1. **Código:** reverter o deploy (revert do PR). A v1 e as tabelas antigas continuam no banco e funcionam com os dados deixados pela v2; a tela volta ao formato mensal.
    2. **Dados do último commit v2** (SQL Editor do Supabase, uma vez por commit, só o commit mais recente): `select public.commerce_rollback_sales_import_v2(<snapshot_id>);` (o `snapshot_id` vem no resultado do commit e em `commerce_sales_commit_log_v2`). Restaura snapshot atual anterior, dias trocados (`*_superseded`), Full diário (`commerce_shopee_full_daily_bak_v2`), financeiro mensal/diário (backups `*_bak_v2`) e limpa o cache de leitura; o lote vira `FAILED` e fica fora do histórico ativo. Falha com `sales_import_rollback_not_current` se já houve commit depois ou se já foi revertido.
    3. Conferir: `select * from commerce_sales_reconcile_v2();` e abrir o Dashboard (a versão do cache muda sozinha).
- Arquivos **"antigos"**: ver `STALE_FILE` acima. Importar um relatório gerado antes do que já está salvo mantém os dias salvos e mostra quais foram mantidos.
- Arquivo com **vários meses**: cada dia vai para o seu mês; só os meses tocados são recalculados.

## Armadilhas

- **Lacuna conhecida:** um dia em que todas as vendas foram canceladas não é substituído na reimportação (nada novo chega para trocar o antigo).
- **Histórico incompleto:** vendas de 2025 do Mercado Livre nunca foram importadas. Comparações entre anos para o ML devem mostrar "sem base", não zero.
- **Ausência não é zero.** Se um arquivo não cobre um período, não trate o período como "vendeu 0".
- Cabeçalhos são reconhecidos por nomes (com variações). Se a Shopee ou o ML renomear uma coluna, a importação pode quebrar ou recusar: ajustar os aliases em `commerce-sales-import-reader.js`, não "relaxar" a regra.
- O arquivo tem limite de tamanho e de linhas (constantes em `commerce-xlsx-reader.js`).
- **Migração SQL não roda sozinha no deploy.** Importação nova com função SQL nova precisa da migração aplicada antes de usar ([[deploy]]).
- O `commit` atual é a `commerce_commit_sales_import_v2` (migração `20261123210000_commerce_commit_sales_import_v2.sql`). A `_v1` ficou só para reversão; ler a v2 antes de mexer.
- **Testes do banco**: `npm run test:db:install` (uma vez, instala só em `test/db`) e `npm run test:db` sobem um Postgres 17 local e descartável com dados fictícios (grátis; nunca toca o Supabase). Rodam no CI como o job `database` do Production Gate (obrigatório depois que o check "database" for marcado como exigido nas regras do branch no GitHub; isso é configuração do GitHub, não do código). Os 2 testes "ignorados" do `npm test` são verificadores de sintaxe de scripts PowerShell que só rodam onde existe `pwsh`.
- Arquivo anual grande gera muitas requisições (linhas e referências de pedido por dia). Prefira arquivos de um mês ou menos.

## Cuidados ao mexer

- Regra de importação mudou? Atualizar esta nota e o [[MAPA-GA]] no mesmo PR.
- Mexeu na leitura? Testar com uma planilha real pequena e comparar os totais com o que o marketplace mostra.
- Nunca importar arquivos de clientes nem dados reais em testes versionados (o repositório é público).

## Arquivos principais

- `src/ga/commerce-import-options.js`: lista dos tipos de importação.
- `src/ga/commerce-import-center.jsx`: tela de envio (catálogo e vendas, arquivo grande). `src/ga/commerce-import-client.js`: envia os dados lidos ao servidor, em pedaços.
- `src/ga/commerce-sales-import-reader.js`: leitor de vendas (Shopee e genérico); `commerce-ml-native-sales-reader.js` (ML Vendas BR); `commerce-shopee-sales-info.js` e `commerce-shopee-finance-aggregation.js` (Shopee).
- `src/ga/commerce-xlsx-reader.js` e `commerce-import-normalizer.js`: leitura de planilha e normalização do catálogo.
- `src/ga/commerce-admin-router.js` (rotas `/sales/imports/*` e `/imports/*`) e `src/ga/commerce-supabase-store.js`.
- **Planilha de anúncios do Mercado Livre (comparação):** roda no banco em ~5 s (era 27 s). O limite de chamadas da tela é 8 s; se voltar a estourar ("A comparação do lote não terminou", lote PARSED), o gargalo é `commerce_auto_link_ml_active_v1` (ver MAPA-GA, 17/11/2026). Catálogo maior = mais lento.
- **Vínculo sem SKU:** o gatilho `commerce_listing_products_fill_sku_trg` preenche `product_sku_id` sozinho quando `platform_sku` bate com um único SKU do mesmo produto (não cria SKU, não recusa gravação). Se o produto não tem o SKU cadastrado, o vínculo fica sem SKU: cadastrar o SKU em `commerce_product_skus` e ligar.
