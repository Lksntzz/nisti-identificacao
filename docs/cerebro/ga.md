# GA — Gestor de Anúncios

Painel de gestão comercial em `ga.sistemanistiid.online`. Leitura e análise de vendas por marketplace (Shopee, Mercado Livre antigo e novo), anúncios, importações e comparações entre anos.
Detalhe completo (tabelas, funções, histórico): [[MAPA-GA]]. Esta nota é só o resumo para se orientar.

## Caminho de um dado

`tela (src/commerce-*.jsx)` → `/api/admin/commerce/...` → router (`src/ga/commerce-admin-router.js` e vizinhos) → store (`src/ga/commerce-supabase-store.js`, via `supabaseRpc`) → função SQL `commerce_*_vN` → tabelas.

O navegador nunca fala com o banco. Toda função SQL do GA termina em `_vN` e só `service_role` executa.

## Telas

- **Dashboard** (`commerce-dashboard.jsx`): faturamento por mês/plataforma, quedas, ABC, Ads.
- **Anúncios com problema** (menu 'why', abaixo de Categorias; `commerce-problems.jsx`, regras em `commerce-problems-logic.js`): unidade = ANÚNCIO ativo, em 4 grupos (Parou = sem venda na janela escolhida, Em queda, Pior performance, Nunca vendeu; os cards do Dashboard abrem o painel com os mesmos filtros), um por anúncio nessa ordem; janela 30/60/90 contra a média dos 3 meses completos anteriores. Rotas `/api/admin/commerce/problems/groups` e `/problems/platforms`, SQL `commerce_problem_groups_v1` e `commerce_platform_diagnosis_v1`. Pior performance e Nunca vendeu só Shopee; ML não tem motivo nem idade. O GA só sugere desativar. Dashboard: sem cards Faturamento/Vendendo, Vendas por dia recolhível, plataforma em pizza, Atenção e Resumo por plataforma (`commerce-dashboard-problems.jsx`). O painel antigo abaixo (Por que parou) deixou de ser exibido; arquivo mantido.
- **Conciliação Shopee** (só SQL, sem tela; GA-011): `commerce_shopee_reconciliation_v1(p_start,p_end,p_limit)`, só leitura, só `service_role`. Compara vendas por SKU (fonte) com vendas por anúncio (base `commerce_current_sales_listing_daily_v1`) usando o vínculo `commerce_shopee_sku_owner_reviewed_v1` (SKU antigo→atual preservado). SKU sem vínculo nunca é descartado (`unmatched_skus` completo); dia sem importação é dado ausente (`status` SEM_DADOS/PARCIAL/COMPLETO, `coverage.missing_ranges`), nunca zero. `residual` deve ser 0.
- **Por que parou** (menu, abaixo de Categorias; `commerce-why-stopped.jsx`): anúncios ativos da Shopee que caíram/pararam e o motivo provável (visibilidade, cliques, conversão, preço) comparando dois relatórios `parentskudetail` sem sobreposição (`commerce_shopee_why_stopped_v1`).
- **Painel Comercial** (`commerce-ad-manager.jsx`): lista de anúncios, vínculo por SKU, botão "Importar arquivo".
- **Planejamento de Produtos** (`commerce-products-view.jsx`): ativo, rascunho, desativado.
- **Histórico de importações** (`commerce-import-history.jsx`).
- **Histórico do anúncio** (aba no detalhe de anúncio Shopee, `commerce-listing-sheet.jsx`): vendas por semana, preço praticado, funil, o que sobra por unidade, cancelamentos, Ads. Lê `commerce_shopee_listing_sheet_v1`. Dados de pedido vêm de `commerce_shopee_order_extras_daily_v1` (ver [[importacao]]).
- **Categorias** (`commerce-categories-panel.jsx`, `commerce-dashboard-categories.jsx`): vendas por categoria; usa a comparação entre anos (`annual-coverage`).

A tela **Comparação anual** foi removida em 05/11/2026 (PR #839) e o back-end sem uso foi apagado depois. Ver o fim do [[MAPA-GA]].

- **Qualidade dos dados (GA-018, publicada):** `commerce-data-quality.jsx` → `/api/admin/commerce/data-quality` → `commerce_data_quality_v1` (somente leitura, sem cache). Atualização, cobertura e conciliação são separadas; conciliação é só consistência interna. Detalhes no `docs/MAPA-GA.md`.

## Regras de negócio que já causaram erro

- **Comparação por anúncio (histórico, tela removida):** a unidade era o número do anúncio (`external_listing_id`), nunca o SKU; "novo" = sem venda no ano-base inteiro; mês em andamento comparava o ano-base cortado na mesma data; ausência de dado não é zero (Mercado Livre 2025 nunca foi importado). Se a tela voltar, retomar essas regras.
- **Importação Shopee:** confirmado = status válido E pagamento. Cancelados (ML e Shopee) ficam fora. Full = "Pedido FBS" = Yes ou "Opção de envio" = Full.

## Cuidados ao mexer

- A view `commerce_current_sales_listing_daily_v1` alimenta **todas** as telas de vendas. Mudar nela afeta tudo; só com comparação antes/depois.
- Mudar a curva ABC exige comparar resultado antigo x novo em vários casos (já divergiu antes).
- Leituras do dashboard têm cache de 5 min (`src/ga/commerce-read-cache.js`); gravações zeram; `?fresh=1` ignora.
- As leituras do GA saem em fila (máx. 3 ao mesmo tempo) em `src/ga/commerce-manager-fetch.js`; sem isso, logo após importar, o Dashboard estourava o limite de 8 s do banco.
- Função SQL nova: `_v1`, revogar de `public, anon, authenticated`, conceder a `service_role`. Função existente: ler a definição atual antes e mudar só o necessário.
- Apagar dados: mostrar contagem, pedir aprovação explícita e fazer backup antes. Backups `bak_*` só saem a pedido do Lucas.

## Limpeza

O back-end sem uso da antiga Comparação anual foi apagado em 05/11/2026 (11 funções SQL e as rotas/funções do store). Ainda sem tela: as rotas e tabelas de **famílias** (`families/*`, `commerce_annual_family_report_v1`); decidir à parte. Apagar dados: só com contagem, backup e aprovação. Detalhes no fim do [[MAPA-GA]].

## Ao terminar uma mudança no GA

Atualizar o [[MAPA-GA]] (seção 10 ou a correspondente) e esta nota, no mesmo PR. Fluxo de publicação: [[deploy]].
- "Pararam" não é mais aba: é o filtro "Vendia e parou" dentro de "Sem vendas". Regra no navegador (`stopBand` em `commerce-dashboard.jsx`): máximo 90 dias parado e, com 7/30/60/90, só a faixa N a N+6 dias (90 = só 90). Em 90 dias a lista costuma ficar vazia.
