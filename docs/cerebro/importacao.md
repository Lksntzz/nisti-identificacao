# Importação de planilhas (Shopee e Mercado Livre)

Botão **Importar arquivo** do Painel Comercial (GA). Vendas, catálogo e relatórios chegam por planilha `.xlsx`; não há API dos marketplaces. Contexto geral: [[ga]]. Detalhe de tabelas e funções: seção 4 do [[MAPA-GA]].

## Tipos de importação

Registro único em `src/ga/commerce-import-options.js` (alimenta o menu e a tela de envio). Cada tipo tem leitor, tela e função SQL próprios:

- **Produtos e anúncios** (catálogo por plataforma): lote em etapas (criar lote → linhas → conciliar → aprovar → commit). Rotas `/imports/...`.
- **Vendas**: o foco desta nota. Rotas `/sales/imports/...`.
- **Shopee Ads, Desempenho (Shopee e ML) e Pós-venda Shopee**: relatórios **isolados**. Nunca alteram vendas, pedidos nem SKUs.

## Caminho das vendas

1. **O navegador lê a planilha** (`read-excel-file/browser`, em `commerce-sales-import-reader.js`). O servidor não recebe o arquivo: recebe os dados já lidos, em partes.
2. `src/ga/commerce-import-client.js` envia JSON em pedaços (lotes de linhas), nesta ordem: criar lote → `rows` → `summary` → **`orders`** (chaves dos pedidos por dia) → `listing-daily` (vendas por anúncio por dia) → `sku-daily` (Shopee) → `finance-month` → `finance-daily` → `shopee-full` → **`commit`**. O `commit` é o último passo. **Desde a GA-019 `rows` e `summary` são POR DIA** (`period_key` = data real do pedido), não por mês.
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
  - **Cobertura comprovada = datas observadas nos pedidos** (menor e maior data). Dia dentro do intervalo sem venda = "sem vendas" (gravado em `commerce_sales_day_coverage_v2`, `has_sales=false`). Dia fora do intervalo = **sem informação** (não existe registro). O nome do arquivo não define cobertura. Ausência continua não sendo zero.
  - **Por dia, o lote de snapshot mais novo vence** (mesma regra do gatilho e das views). Duas proteções: dia **parcial** (último dia do arquivo quando o arquivo foi criado no próprio dia) não substitui dia **completo**; dia **sem vendas** não apaga dia que já tinha vendas. O que foi mantido volta no resultado do commit em `kept_days` (`PARTIAL_DAY` ou `ZERO_CONFLICT`).
  - Os **meses tocados são reconstruídos** a partir de todos os dias vencedores (`commerce_sales_day_rows_v2`); plataformas e meses não tocados são copiados do snapshot anterior. O rótulo do período é `YYYY-MM (01-DD)` até o último dia com venda, ou `YYYY-MM` quando vai até o fim do mês.
  - **Pedidos únicos** = chaves distintas por dia em `commerce_sales_import_stage_orders_v2` (inclusive entre partes do mesmo arquivo). Nunca a soma de `orders_with_item` por SKU. Mês antigo (legado) sem chaves só tem pedido exato se o arquivo legado foi um bloco único e nenhum dia dele foi trocado; senão o commit **falha** com `sales_import_orders_unresolved` (reexportar o mês inteiro). Não se estima.
  - **Trava global**: `pg_advisory_xact_lock(hashtextextended('commerce_sales_commit',2026))` no começo; dois commits (de qualquer plataforma) nunca montam snapshot ao mesmo tempo. A v1 **não** usa essa trava.
  - **Atômico**: tudo numa transação; qualquer erro desfaz tudo (lote continua `STAGED`, nenhum snapshot novo, cache intacto). O cache (`commerce_data_version_v1`) só muda quando um lote vira `COMMITTED`.
  - **`Order.toship`** (pedidos para enviar) é recusado no leitor, na rota de criar lote e no banco (`sales_import_toship_blocked`) até a finalidade do arquivo ser validada.
  - O leitor exige **data e ID do pedido em toda linha** (senão para) e envia só a chave embaralhada (SHA-256 truncado em 32 caracteres) do pedido, nunca o número real. **Atenção:** a chave é pseudônimo, não anonimização forte; quem tem acesso ao banco e uma lista de números de pedido consegue conferir se um pedido está lá.
  - Financeiro Shopee: `commerce_activate_shopee_finance_v2` grava o diário sempre e o **mensal só quando todos os dias do mês pertencem ao mesmo arquivo** (a view `commerce_shopee_finance_current_month_v1` esconde o mês quando o snapshot do mês mudou). Mês misturado de arquivos fica sem financeiro mensal; vem em `finance_months_mixed_not_published`.
  - Importar um mês **antigo** que o detalhe diário não reproduz falha com `sales_import_month_not_rebuildable` (reexportar o mês inteiro).
  - **Reversão:** a v1 e as tabelas antigas continuam no banco. Desfazer o código = reverter o PR (o Worker e a tela voltam juntos para o formato mensal). Lote já commitado na v2: ver "Reversão" no relatório da GA-019 (voltar `is_current` ao snapshot anterior; dias trocados ficam em `*_superseded`).
- Arquivo com **vários meses**: cada dia vai para o seu mês; só os meses tocados são recalculados.

## Armadilhas

- **Lacuna conhecida:** um dia em que todas as vendas foram canceladas não é substituído na reimportação (nada novo chega para trocar o antigo).
- **Histórico incompleto:** vendas de 2025 do Mercado Livre nunca foram importadas. Comparações entre anos para o ML devem mostrar "sem base", não zero.
- **Ausência não é zero.** Se um arquivo não cobre um período, não trate o período como "vendeu 0".
- Cabeçalhos são reconhecidos por nomes (com variações). Se a Shopee ou o ML renomear uma coluna, a importação pode quebrar ou recusar: ajustar os aliases em `commerce-sales-import-reader.js`, não "relaxar" a regra.
- O arquivo tem limite de tamanho e de linhas (constantes em `commerce-xlsx-reader.js`).
- **Migração SQL não roda sozinha no deploy.** Importação nova com função SQL nova precisa da migração aplicada antes de usar ([[deploy]]).
- O `commit` atual é a `commerce_commit_sales_import_v2` (migração `20261123210000_commerce_commit_sales_import_v2.sql`). A `_v1` ficou só para reversão; ler a v2 antes de mexer.
- **Testes do banco**: `npm run test:db` sobe um Postgres 17 local e descartável (pacotes `embedded-postgres` e `pg`, instalados com `npm install --no-save`), com dados fictícios. Não roda no `npm test` nem no CI; rodar antes de mexer no commit.
- Arquivo anual grande gera muitas requisições (linhas e chaves de pedido por dia). Prefira arquivos de um mês ou menos.

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
