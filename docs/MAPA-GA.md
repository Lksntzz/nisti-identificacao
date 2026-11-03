# Mapa do GA – Gestor de Anúncio

Documento de orientação. **Não altera o sistema.** Gerado em 27/10/2026 (seção 10 atualizada em 03/11/2026) a partir do código (`src/`), das migrações (`supabase/migrations/`) e do banco de produção (Supabase `yioetdcbgorunwgwuawg`). Se algo aqui divergir do código, vale o código: atualize este arquivo.

## 1. Em números

| Item | Quantidade |
|---|---|
| Arquivos em `src/` (NISTI ID + GA) | 146, dos quais 71 são do GA (`commerce-*`) |
| Migrações | 320 |
| Arquivos de teste | 272 |
| Tabelas no banco | 94 (69 do GA `commerce_*`, sendo 20 `commerce_preview_*`) |
| Funções do GA (`commerce_*`) | 270 |
| Dessas: usadas pelo código | 118 |
| Dessas: auxiliares chamadas por outras funções | 57 |
| Dessas: gatilhos | 3 |
| Dessas: família `preview` | 72 |
| Dessas: sem uso aparente | 20 |

Regra do banco: toda função do GA termina em `_vN` (versão) e só o servidor (`service_role`) pode executá-la. O navegador nunca fala direto com o banco.

## 2. Caminho de um dado

`Tela (src/*.jsx)` → chama `/api/admin/commerce/...` → `router (src/*-router.js)` → função do `store` (`src/commerce-supabase-store.js`, via `supabaseRpc`) → função SQL `commerce_..._vN` → tabelas.

Arquivos centrais:

| Papel | Arquivo |
|---|---|
| Entrada do GA (hostname próprio, login próprio) | `src/ga-access.js`, `src/commerce-admin-app-v2.jsx` |
| Chamadas HTTP da tela | `src/commerce-admin-api.js`, `src/commerce-manager-fetch.js` |
| Rotas principais | `src/commerce-admin-router.js` |
| Rotas de edição / estado de anúncio / produto / campanhas de atualização | `commerce-listing-editor-router.js`, `commerce-listing-state-router.js`, `commerce-product-state-router.js`, `commerce-update-admin-router.js` |
| Chamadas ao banco | `src/commerce-supabase-store.js` (+ `commerce-listing-state-store.js`, `commerce-product-state-store.js`, `commerce-update-store.js`, `commerce-rpc.js`) |

## 3. Telas do GA

Menu em `commerce-admin-app-v2.jsx`:

| Tela no menu | Arquivo principal | Para quê | Funções do banco principais |
|---|---|---|---|
| Dashboard | `commerce-dashboard.jsx` (+ `.css`) | Resultado: faturamento por mês e plataforma, quedas, parou de vender, sem vendas, ABC, Ads, visitas e conversão | `dashboard_v1`, `dashboard_overview_v1`, `dashboard_series_v1`, `dashboard_segment_series_v1`, `dashboard_monthly_v1`, `ml_performance_latest_v1`, `shopee_performance_latest_v1` |
| Painel Comercial | `commerce-ad-manager.jsx` (+ vários `.css`) | Lista de anúncios (Gestor de Anúncios): filtros, vínculo por SKU, vendas sem vínculo, conciliação, botão **Importar arquivo** | `listing_manager_v1`, `listing_manager_*`, `sales_abc_*`, `shopee_unlinked_sales_v1`, `listing_price_signal_v1`, `listing_traffic_window_v1`, `listing_performance_diagnosis_v1` |
| Planejamento de Produtos | `commerce-products-view.jsx` | Controle de produtos: ativo, rascunho, desativado (histórico mantido) | `list_products_planning_cards_v1`, `set_product_state_v1`, `set_listing_state_v1` |
| Histórico de importações | `commerce-import-history.jsx` | Conferir e excluir importações | `list_import_batches_v1`, `list_sales_imports_v1`, `sales_import_history_v1`, `delete_import_batch_v1` |

Observação: a antiga aba "Evolução de vendas" do Painel Comercial foi removida em 27/10/2026. O código da tela (`commerce-evolution-integrated.*`, ajudas e estilos), as rotas `/listings/manager/evolution*` e as funções do store foram removidos em 27/10/2026. As funções SQL `evolution_ads_v1`, `evolution_ad_weekly_v1` e `sales_evolution_v1` continuam no banco, sem uso (ver seção 7).

## 4. Importação (menu "Importar arquivo")

Registro único das opções: `src/commerce-import-options.js`. Janela: `commerce-import-modal.jsx` → `commerce-import-center.jsx`.

| Tipo | Leitor do arquivo | Tela | Gravação (função SQL) | Tabelas principais |
|---|---|---|---|---|
| Produtos e anúncios | `commerce-xlsx-reader.js`, `commerce-import-normalizer.js` | `commerce-import-center.jsx` | `create_import_batch_v2`, `append_import_rows_v1`, `reconcile_*`, `commit_import_batch_account_v5` | `import_batches`, `import_rows`, `reconciliation_candidates`, `listings`, `listing_products`, `products`, `product_skus` |
| Vendas | `commerce-ml-native-sales-reader.js`, `commerce-shopee-sales-info.js`, `commerce-shopee-finance-aggregation.js` | `commerce-import-center.jsx` | `create_sales_import_v1`, `append_sales_*`, `commit_sales_import_v1` | `sales_import_batches`, `sales_import_stage_*`, `sales_rows`, `sales_listing_daily_v1`, `shopee_sales_sku_daily_v1`, `shopee_finance_*` |
| Shopee Ads | `commerce-shopee-ads-csv-reader.js` | `commerce-shopee-ads-import.jsx` | `shopee_ads_import_v1` | `shopee_ads_reports_v1`, `shopee_ads_rows_v1` |
| Desempenho (Shopee / ML Novo / ML Antigo) | `commerce-shopee-performance-reader.js`, `commerce-ml-performance-reader.js` | `commerce-performance-import.jsx` → `commerce-shopee-performance-import.jsx` ou `commerce-ml-performance-import.jsx` | `shopee_performance_import_v1`, `ml_performance_import_v1` | `shopee_performance_reports_v1/rows_v1`, `ml_performance_reports_v1/rows_v1` |
| Pós-venda Shopee | `commerce-shopee-aftercare-reader.js` | `commerce-shopee-aftercare-import.jsx` | `shopee_aftercare_import_v1` | `shopee_aftercare_reports_v1`, `_requests_v1`, `_items_v1` |

Os relatórios de desempenho e Ads são **dados isolados**: nunca alteram vendas, pedidos nem SKUs.

## 5. Tabelas por assunto (prefixo `commerce_` omitido)

| Assunto | Tabelas | Observação |
|---|---|---|
| Plataformas | `marketplaces`, `marketplace_accounts`, `marketplace_snapshots` | Mercado Livre tem contas ANTIGO e NOVO |
| Produtos | `products`, `product_skus`, `categories`, `subcategories`, `product_media_links`, `product_state_events` | 1 produto = 1 variação/SKU. Status: DRAFT / ACTIVE / DISCONTINUED |
| Anúncios | `listings`, `listing_products`, `listing_overrides`, `listing_edit_history`, `listing_year_updates` | `listings` = anúncio na plataforma; `listing_products` liga anúncio a produto. Status do anúncio: ACTIVE / PAUSED / INACTIVE / REMOVED / UNKNOWN |
| Vínculo com o scanner NISTI | `nisti_product_links`, `source_files`, `source_rows` | Origem: planilha de gestão e scanner |
| Importação de catálogo | `import_batches`, `import_rows`, `reconciliation_candidates` | Lote → linhas → candidatos de conciliação |
| Vendas | `sales_import_batches`, `sales_import_stage_rows`, `sales_import_stage_summary`, `sales_rows`, `sales_summary_rows`, `sales_snapshots`, `sales_listing_daily_v1`, `manual_listing_sales` | `sales_listing_daily_v1` alimenta o Dashboard (view `current_sales_listing_daily_v1`) |
| Shopee – vendas e financeiro | `shopee_sales_sku_daily_v1`, `shopee_sales_sku_alias_reviews_v1`, `shopee_sales_history_reviews_v1`, `shopee_finance_daily_v1`, `shopee_finance_month_v1`, `shopee_finance_stage_*` | |
| Shopee – Ads, desempenho, pós-venda | `shopee_ads_*`, `shopee_performance_*`, `shopee_aftercare_*` | Uma tabela de relatório + uma de linhas |
| Mercado Livre – desempenho | `ml_performance_reports_v1`, `ml_performance_rows_v1` | Novo em 27/10/2026 |
| Tráfego | `listing_traffic_reports_v1` | |
| Campanhas de atualização | `update_campaigns`, `update_items`, `update_checks` | |
| Proteção (novo) | `public.commerce_audit_log_v1` (histórico de alterações) e schema `backup` (cópias semanais) | Domingo 03h (Brasília); 4 cópias; histórico apaga o que tem mais de 180 dias |
| Preview (legado) | 20 tabelas `commerce_preview_*` | Ver seção 7 |

## 6. Funções por família

| Família (nome começa com) | O que faz |
|---|---|
| `dashboard_*` | Dados do Dashboard |
| `listing_manager_*`, `list_listings_*`, `listing_*` | Lista de anúncios, vendas por mês, sinais de preço e tráfego |
| `sales_*` | Vendas, ABC, velocidade, produto/performance |
| `shopee_*` | Tudo específico da Shopee (vínculo de SKU, histórico sem vínculo, financeiro, Ads, desempenho, pós-venda) |
| `ml_performance_*` | Desempenho do Mercado Livre |
| `management_*`, `nisti_*`, `sync_nisti_*`, `reconcile_nisti_*` | Planilha de gestão e vínculo com o scanner |
| `create_/append_/reconcile_/commit_/finalize_/delete_import_*` | Importação de catálogo (em etapas) |
| `set_*_state_v1`, `queue_listing_sync_v1`, `edit_listing_v1`, `bulk_edit_listings_v1` | Alterações em produtos e anúncios |
| `*_key_v1`, `sku_*`, `slug_v1`, `match_key_v1` | Funções pequenas de normalização de SKU/nomes |

**Versões antigas:** várias funções existem em mais de uma versão (ex.: `reconcile_import_batch` v1 a v8, `commit_import_batch_account` v1 a v5). O código usa **uma** (a mais recente, em geral). As antigas são chamadas por outras ou estão sem uso.

## 7. Candidatos a limpeza (NADA foi removido)

Antes de apagar qualquer coisa: fazer uma cópia (`select backup.take_snapshot_v1(4)`) e pedir confirmação explícita.

**20 funções sem uso aparente** (não chamadas pelo código, nem por outras funções, nem por gatilhos; podem ainda ser usadas por algo que a busca não vê, então são só candidatas):
`approve_new_rows_v1`, `commit_import_batch_v4`, `import_batch_v1`, `ingest_shopee_snapshot_v1`, `list_listings_v3`, `list_products_v2`, `listing_history_v1`, `listing_manager_month_sku_v1`, `management_products_v1`, `product_platform_detail_v1`, `promote_preview_catalog_v1`, `reconcile_import_batch_account_v1`, `reconcile_import_batch_v8`, `reconcile_nisti_product_v2`, `reconcile_nisti_product_v3`, `reconcile_nisti_product_v4`, `sales_listing_performance_v1`, `sales_velocity_v1`, `sync_import_listing_states_v1`, `sync_management_platforms_to_master_v1`.

**Família preview:** 72 funções e 20 tabelas `commerce_preview_*` (quase todas vazias). O código as cita em `commerce-rpc.js` e `commerce-admin-router.js` (provavelmente para um ambiente de testes). Confirmar se o ambiente de preview ainda é usado antes de qualquer remoção.

**Evolução de vendas:** o código já foi removido (27/10/2026). Falta apagar do banco as funções `evolution_ads_v1`, `evolution_ad_weekly_v1` e `sales_evolution_v1`.

**Removidos em 27/10/2026:** o editor antigo `commerce-catalog-workspace.jsx`, `supabase-reserve-backfill.js`, `GtinRegistryView.jsx` e 9 funções soltas. **Ainda anotado:** anúncios duplicados do planner Aqua.

## 8. Arquivos grandes (risco ao alterar)

| Arquivo | Linhas | Cuidado |
|---|---|---|
| `commerce-supabase-store.js` | ~1.250 | Todas as chamadas ao banco. Uma troca errada de nome quebra a tela correspondente |
| `commerce-import-center.jsx` | ~1.180 | Catálogo e vendas em um só componente |
| `commerce-admin-router.js` | ~1.150 | Muitas rotas juntas |
| `commerce-ad-manager.jsx` | ~990 | Lista de anúncios + filtros + conciliação |

## 9. Regras para mudar com segurança

1. Função SQL nova: sempre `_v1`, `revoke ... from public, anon, authenticated` e `grant execute ... to service_role`.
2. Alterar função existente: ler a definição atual (`pg_get_functiondef`), trocar só o trecho necessário e falhar se o trecho não existir.
3. Testar escrita no banco com um bloco `DO` terminado em `raise exception 'TESTE_OK'` (desfaz tudo).
4. Salvar toda migração aplicada em `supabase/migrations/`.
5. Publicar por PR; esperar as checagens; só então mesclar.
6. Nada de dados de negócio em arquivos do repositório (ele é público).
7. Mexeu em tela, tabela, função SQL, rota ou regra de importação? Atualize este mapa no mesmo PR.

## 10. Mudanças de 28/10 a 03/11/2026

**Faturamento Full x envio próprio** (card do Dashboard)
- Rota `/sales-dashboard/shipping` → função SQL `commerce_dashboard_shipping_split_v1(p_start,p_end)`.
- Só Shopee e só meses inteiros. Até 01/10/2026 usa a tabela manual `commerce_shopee_full_monthly_v1`; de 01/11/2026 em diante usa `commerce_shopee_full_daily_v1`.
- O importador de vendas Shopee (`commerce-sales-import-reader.js`) detecta Full pela coluna "Pedido FBS" = Yes ou "Opção de envio" = Full e envia por dia (`/sales/imports/{id}/shopee-full`, função `commerce_append_shopee_full_daily_v1`).

**Reimportação de dias (Shopee)**
- Gatilho `commerce_shopee_supersede_old_days_trg`: ao importar um dia de novo, o snapshot novo substitui o antigo e o antigo vai para tabelas de arquivo (`*_superseded`). Cobre também o Full diário.
- Lacuna conhecida: dia em que todas as vendas foram canceladas não é substituído.

**Velocidade**
- Cache de leitura de 60 s (`src/commerce-read-cache.js`) para GET em `/sales-dashboard*` e `/sales-compare/*`. Qualquer gravação (POST/PUT/PATCH/DELETE) zera o cache. `?fresh=1` ignora o cache; o botão de atualizar da tela usa isso por 15 s. Resposta em cache vem com o cabeçalho `x-ga-cache: HIT`.
- `commerce_dashboard_abc_v2` foi reescrita (mesmo resultado, 3 a 7 vezes mais rápida). Índice `commerce_listings_external_listing_idx`.
- Maior custo restante: a view `commerce_current_sales_listing_daily_v1`, usada por todas as telas de vendas (~700 ms por chamada). Reescrever é arriscado: só com testes de antes/depois.

**Avisos de segurança**
- Os avisos "Atividades do Sistema" ficam na tabela `notifications` (tipo `admin_login`, `admin_login_failed`; IP, aparelho e local dentro do JSON da coluna `platform`).
- Só o login real (POST em `/admin-login`) gera aviso de sessão iniciada. Abrir a página de login (GET) é robô e é ignorado. Recusa de fora do Brasil recebe título próprio.
- Registros GET antigos (cerca de 380 até 03/11) continuam no histórico.

**Comparação anual: abas Picos e sazonalidade / Lançamentos** (03/11/2026)
- Telas dentro de `commerce-annual-guided.jsx`: abas "Comparação", "Picos e sazonalidade" e "Lançamentos {ano}". Código das duas abas em `commerce-annual-seasonality.jsx` (+ `commerce-annual-seasonality.css`, estilos com escopo `.ga-y-extra`).
- Rotas `/sales-compare/annual-seasonality` e `/sales-compare/annual-launches` → funções SQL `commerce_annual_seasonality_v1` e `commerce_annual_launches_v1`, que leem `commerce_current_sales_listing_daily_v1` (vendas por número do anúncio).
- "Novo" = anúncio (número) sem venda no ano-base inteiro. Mês em andamento: ano anterior cortado na mesma data (usa `periods` da comparação anual).

**Atenção ao publicar**
- Migração em `supabase/migrations/` **não roda sozinha no deploy**. Depois de mesclar, aplicar no Supabase (projeto `yioetdcbgorunwgwuawg`) e conferir.
- Tabelas de backup no banco sem migração: `bak_cls_20261030_*`, `bak_dup_out2025_*`, `bak_dup_out2026_*`. Apagar só com pedido explícito do dono.
- Existe um segundo projeto Supabase de teste (`ppzimdxufmiepxurckfu`, região Ohio, outro app). Não faz parte do NISTI.

