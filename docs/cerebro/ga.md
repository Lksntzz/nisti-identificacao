# GA — Gestor de Anúncios

Painel de gestão comercial em `ga.sistemanistiid.online`. Leitura e análise de vendas por marketplace (Shopee, Mercado Livre antigo e novo), anúncios, importações e comparações entre anos.
Detalhe completo (tabelas, funções, histórico): [[MAPA-GA]]. Esta nota é só o resumo para se orientar.

## Caminho de um dado

`tela (src/commerce-*.jsx)` → `/api/admin/commerce/...` → router (`src/ga/commerce-admin-router.js` e vizinhos) → store (`src/ga/commerce-supabase-store.js`, via `supabaseRpc`) → função SQL `commerce_*_vN` → tabelas.

O navegador nunca fala com o banco. Toda função SQL do GA termina em `_vN` e só `service_role` executa.

## Telas

- **Dashboard** (`commerce-dashboard.jsx`): faturamento por mês/plataforma, quedas, ABC, Ads.
- **Painel Comercial** (`commerce-ad-manager.jsx`): lista de anúncios, vínculo por SKU, botão "Importar arquivo".
- **Planejamento de Produtos** (`commerce-products-view.jsx`): ativo, rascunho, desativado.
- **Histórico de importações** (`commerce-import-history.jsx`).
- **Histórico do anúncio** (aba no detalhe de anúncio Shopee, `commerce-listing-sheet.jsx`): vendas por semana, preço praticado, funil, o que sobra por unidade, cancelamentos, Ads. Lê `commerce_shopee_listing_sheet_v1`. Dados de pedido vêm de `commerce_shopee_order_extras_daily_v1` (ver [[importacao]]).
- **Categorias** (`commerce-categories-panel.jsx`, `commerce-dashboard-categories.jsx`): vendas por categoria; usa a comparação entre anos (`annual-coverage`).

A tela **Comparação anual** foi removida em 05/11/2026 (PR #839) e o back-end sem uso foi apagado depois. Ver o fim do [[MAPA-GA]].

## Regras de negócio que já causaram erro

- **Comparação por anúncio (histórico, tela removida):** a unidade era o número do anúncio (`external_listing_id`), nunca o SKU; "novo" = sem venda no ano-base inteiro; mês em andamento comparava o ano-base cortado na mesma data; ausência de dado não é zero (Mercado Livre 2025 nunca foi importado). Se a tela voltar, retomar essas regras.
- **Importação Shopee:** confirmado = status válido E pagamento. Cancelados (ML e Shopee) ficam fora. Full = "Pedido FBS" = Yes ou "Opção de envio" = Full.

## Cuidados ao mexer

- A view `commerce_current_sales_listing_daily_v1` alimenta **todas** as telas de vendas. Mudar nela afeta tudo; só com comparação antes/depois.
- Mudar a curva ABC exige comparar resultado antigo x novo em vários casos (já divergiu antes).
- Leituras do dashboard têm cache de 5 min (`src/ga/commerce-read-cache.js`); gravações zeram; `?fresh=1` ignora.
- Função SQL nova: `_v1`, revogar de `public, anon, authenticated`, conceder a `service_role`. Função existente: ler a definição atual antes e mudar só o necessário.
- Apagar dados: mostrar contagem, pedir aprovação explícita e fazer backup antes. Backups `bak_*` só saem a pedido do Lucas.

## Limpeza

O back-end sem uso da antiga Comparação anual foi apagado em 05/11/2026 (11 funções SQL e as rotas/funções do store). Ainda sem tela: as rotas e tabelas de **famílias** (`families/*`, `commerce_annual_family_report_v1`); decidir à parte. Apagar dados: só com contagem, backup e aprovação. Detalhes no fim do [[MAPA-GA]].

## Ao terminar uma mudança no GA

Atualizar o [[MAPA-GA]] (seção 10 ou a correspondente) e esta nota, no mesmo PR. Fluxo de publicação: [[deploy]].
