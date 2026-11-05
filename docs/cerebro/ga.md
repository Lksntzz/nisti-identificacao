# GA — Gestor de Anúncios

Painel de gestão comercial em `ga.sistemanistiid.online`. Leitura e análise de vendas por marketplace (Shopee, Mercado Livre antigo e novo), anúncios, importações e comparações entre anos.
Detalhe completo (tabelas, funções, histórico): [[MAPA-GA]]. Esta nota é só o resumo para se orientar.

## Caminho de um dado

`tela (src/commerce-*.jsx)` → `/api/admin/commerce/...` → router (`src/commerce-admin-router.js` e vizinhos) → store (`src/commerce-supabase-store.js`, via `supabaseRpc`) → função SQL `commerce_*_vN` → tabelas.

O navegador nunca fala com o banco. Toda função SQL do GA termina em `_vN` e só `service_role` executa.

## Telas

- **Dashboard** (`commerce-dashboard.jsx`): faturamento por mês/plataforma, quedas, ABC, Ads.
- **Painel Comercial** (`commerce-ad-manager.jsx`): lista de anúncios, vínculo por SKU, botão "Importar arquivo".
- **Planejamento de Produtos** (`commerce-products-view.jsx`): ativo, rascunho, desativado.
- **Histórico de importações** (`commerce-import-history.jsx`).
- **Comparação anual** (`commerce-annual-guided.jsx` + `commerce-annual-seasonality.jsx` e `commerce-annual-insights.jsx`): abas de comparação entre anos.

## Regras de negócio que já causaram erro

- **A unidade de comparação é o número do anúncio** (`external_listing_id`), nunca o SKU.
- **"Novo" = anúncio sem nenhuma venda no ano-base inteiro.** Não entra em comparação, só em resumo separado.
- **Mês em andamento:** o ano-base é cortado na mesma data (mesmo número de dias), senão a comparação engana.
- **Ausência de dado não é zero.** Se o ano-base não foi importado (hoje o Mercado Livre de 2025), mostrar "sem base", nunca queda de 100%.
- **Queda de anúncio antigo pode ser migração de vendas para anúncio novo.** O painel não consegue separar isso: é hipótese, nunca afirmar.
- **Importação Shopee:** confirmado = status válido E pagamento. Cancelados (ML e Shopee) ficam fora. Full = "Pedido FBS" = Yes ou "Opção de envio" = Full.

## Cuidados ao mexer

- A view `commerce_current_sales_listing_daily_v1` alimenta **todas** as telas de vendas. Mudar nela afeta tudo; só com comparação antes/depois.
- Mudar a curva ABC exige comparar resultado antigo x novo em vários casos (já divergiu antes).
- Leituras do dashboard têm cache de 5 min (`src/commerce-read-cache.js`); gravações zeram; `?fresh=1` ignora.
- Função SQL nova: `_v1`, revogar de `public, anon, authenticated`, conceder a `service_role`. Função existente: ler a definição atual antes e mudar só o necessário.
- Apagar dados: mostrar contagem, pedir aprovação explícita e fazer backup antes. Backups `bak_*` só saem a pedido do Lucas.

## Candidatos a limpeza (não removidos)

Lista completa na seção 7 do [[MAPA-GA]]. Resumo: funções SQL sem uso aparente, família `preview` e funções de "evolução de vendas" ainda no banco sem tela. Só apagar com backup e aprovação.

## Ao terminar uma mudança no GA

Atualizar o [[MAPA-GA]] (seção 10 ou a correspondente) e esta nota, no mesmo PR. Fluxo de publicação: [[deploy]].
