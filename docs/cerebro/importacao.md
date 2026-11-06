# Importação de planilhas (Shopee e Mercado Livre)

Botão **Importar arquivo** do Painel Comercial (GA). Vendas, catálogo e relatórios chegam por planilha `.xlsx`; não há API dos marketplaces. Contexto geral: [[ga]]. Detalhe de tabelas e funções: seção 4 do [[MAPA-GA]].

## Tipos de importação

Registro único em `src/ga/commerce-import-options.js` (alimenta o menu e a tela de envio). Cada tipo tem leitor, tela e função SQL próprios:

- **Produtos e anúncios** (catálogo por plataforma): lote em etapas (criar lote → linhas → conciliar → aprovar → commit). Rotas `/imports/...`.
- **Vendas**: o foco desta nota. Rotas `/sales/imports/...`.
- **Shopee Ads, Desempenho (Shopee e ML) e Pós-venda Shopee**: relatórios **isolados**. Nunca alteram vendas, pedidos nem SKUs.

## Caminho das vendas

1. **O navegador lê a planilha** (`read-excel-file/browser`, em `commerce-sales-import-reader.js`). O servidor não recebe o arquivo: recebe os dados já lidos, em partes.
2. `src/ga/commerce-import-client.js` envia JSON em pedaços (lotes de linhas), nesta ordem: criar lote → `rows` → `summary` → `listing-daily` (vendas por anúncio por dia) → `sku-daily` (Shopee) → `finance-month` → `finance-daily` → `shopee-full` → **`commit`**. O `commit` é o último passo.
3. Funções SQL `commerce_create_sales_import_v1`, `commerce_append_*` e `commerce_commit_sales_import_v1`, chamadas por `commerce-supabase-store.js`. Dados vão para `commerce_sales_listing_daily_v1` e, na Shopee, `commerce_shopee_sales_sku_daily_v1`, que alimentam a view `commerce_current_sales_listing_daily_v1` (usada por todas as telas de vendas).
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
- **Mês incompleto:** se a última venda do arquivo é antes do fim do mês, o período vira parcial (do dia 1 até o último dia com venda), para o mês não parecer completo.
- Várias abas ou meses no mesmo arquivo: a cobertura é calculada **por mês**, para um mês parcial não parecer completo por causa de outro.

## Armadilhas

- **Lacuna conhecida:** um dia em que todas as vendas foram canceladas não é substituído na reimportação (nada novo chega para trocar o antigo).
- **Histórico incompleto:** vendas de 2025 do Mercado Livre nunca foram importadas. Comparações entre anos para o ML devem mostrar "sem base", não zero.
- **Ausência não é zero.** Se um arquivo não cobre um período, não trate o período como "vendeu 0".
- Cabeçalhos são reconhecidos por nomes (com variações). Se a Shopee ou o ML renomear uma coluna, a importação pode quebrar ou recusar: ajustar os aliases em `commerce-sales-import-reader.js`, não "relaxar" a regra.
- O arquivo tem limite de tamanho e de linhas (constantes em `commerce-xlsx-reader.js`).
- **Migração SQL não roda sozinha no deploy.** Importação nova com função SQL nova precisa da migração aplicada antes de usar ([[deploy]]).
- O que o `commit` faz exatamente por dentro (ordem de gravações, o que acontece se falhar no meio): **não confirmado** nesta nota; ler `commerce_commit_sales_import_v1` antes de mexer.

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
