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

- **Seletor de plataformas (GA-012, publicada, validação visual em produção pendente):** `commerce-platform-selector.jsx`, `commerce-platform-scope-logic.js` (chave de escopo; respostas de outra conta são descartadas), `commerce-platform-quality-strip.jsx` (GA-018 por conta, só após o dashboard). Não ler `overview.ads` (SQL devolve Ads da Shopee em qualquer plataforma).
- **GA-021 (PUBLICADA em 24/11/2026, PR #918; migração `20261124150000` aplicada, histórico `20261124204202`):** corrige dez funções que liam a tabela legada de vendas da Shopee crua (somavam os lotes abertos 77 e 78). Nova fonte `commerce_shopee_current_sku_daily_v1` com a regra da GA-019; total x vinculada x sem vínculo em `commerce_shopee_sales_link_split_v1`. Lotes 77 e 78 continuam abertos (não aplicar, excluir nem descartar). **GA-013 (Visão estratégica) segue suspensa** até autorização do Lucas (a GA-021 já está publicada): sem faturamento/lucro/margem e sem classificar crescimento, queda ou ausência de vendas sem cobertura completa (cobertura comprovada só de 01/10/2026 em diante). Detalhes no [[MAPA-GA]] (seção "GA-021").
- **Qualidade dos dados (GA-018, publicada):** `commerce-data-quality.jsx` → `/api/admin/commerce/data-quality` → `commerce_data_quality_v1` (somente leitura, sem cache). Atualização, cobertura e conciliação são separadas; conciliação é só consistência interna. Tela refinada na GA-018A (resumo no topo, seções, cartões enxutos; lógica de apresentação em `commerce-data-quality-logic.js`; conciliação geral só aprovada se todas as aplicáveis estiverem conciliadas). Detalhes no `docs/MAPA-GA.md`.

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

## GA-013 — Visão estratégica (PUBLICADA, 24/11/2026, PR #920, merge c1121d3)
Rota `/api/admin/commerce/strategic-view` (sem cache, só 3 contas), regras em `src/ga/commerce-strategic-logic.js`, tela `commerce-strategic-view.jsx`. Só unidades. Classificação só com cobertura GA-018 comprovada; histórico não verificado fica visível e marcado. Sem migração. Detalhes: `docs/MAPA-GA.md`.
Cobertura real hoje: 7 dias classifica; 30 dias só confirma "parou"; 60/90 e "sem venda" são candidatos (histórico não verificado). GA-014 a GA-017 só após validação visual do Lucas.

## GA-013A — Refino visual da Visão estratégica (PUBLICADA, 24/11/2026, PRs #922 e #923)
Tela reorganizada em 5 áreas (resumo, situação com filtros, gráfico atual x anterior diário/mensal, tabelas, qualidade expansível). Só apresentação; regras da GA-013 intactas; campo novo `listings.with_sales`. Ver `docs/MAPA-GA.md`.
Mensal real: `month` vem como `aaaa-mm-01` (normalizado para `aaaa-mm`). Dia sem informação = lacuna, nunca zero. Validado com dados reais nas 3 contas. GA-014 a GA-017 só com autorização do Lucas.

## GA-014 — função `commerce_decision_units_v1` (APLICADA em 25/11/2026)
Aplicada e validada no Supabase (versão registrada `20261125175917`): `SECURITY INVOKER`, só `service_role`, seis conciliações `CONCILIADA` (3 contas x 7 e 30 dias), no máximo 0,21 s e 286 KB, nenhuma outra função, view, tabela ou lote alterado. A Central (PR #926) passou a usá-la ao ser publicada. Reversão manual: `supabase/rollback/20261125120000_commerce_decision_units_v1.down.sql`. Detalhes na seção GA-014 de `MAPA-GA.md`.

## GA-014 — Central de decisões (PUBLICADA em 25/11/2026 pela PR #926)

**Decisão final do Atlas sobre os períodos (PR #926).** A janela de cada conta termina no **último dia completo comprovado pela GA-018**, nunca na última data importada (que pode ser parcial) e sem confundir "último dia com vendas" com "último dia completo": um dia completo sem vendas pode ser o fim da janela. A GA-018 só devolve contagens, então o servidor consulta um dia por vez, de ontem para trás (até 14 dias, ~0,4 s por consulta); sem nenhum dia completo, a janela termina no último dia importado (antes de hoje) e tudo fica como candidato. Atual e anterior têm o mesmo tamanho, são contíguos e não se sobrepõem. A tela informa a última data importada, o último dia completo comprovado, os dias deixados de fora e as datas efetivamente analisadas. O Dashboard deixou de definir períodos: a conciliação usa a fonte diária da GA-019 (`commerce_sales_daily_source_v2`, só unidades) e a divisão por SKU da GA-021, ambas nas datas exatas da Central, nunca totais de janelas diferentes. Na Shopee a GA-019 pode ter 1 a 4 un a mais que a view (vendas sem vínculo): só vale se a GA-021 explicar a diferença por completo. Bloqueio das classificações confirmadas com dois motivos distintos: **divergência** (as fontes foram lidas e não fecham) e **conferência indisponível** (não pôde ser feita nestas datas; agora também bloqueia, antes só avisava). A idade dos relatórios (limite de 14 dias) é medida a partir de **hoje**. Limiares 20/60, intervalo máximo de 35 dias e duração mínima de 5 dias mantidos. Sem alteração no banco: a #925 segue igual (46cc5ab).

**Correções antes da publicação (25/11).** A diferença entre a GA-019 e a view só é aceita quando a GA-021 a explica com resíduo **numérico igual a zero** (nulo, ausente ou texto não valem). Na busca do último dia completo, as datas devolvidas pela GA-018 (início, fim e "hoje") precisam ser exatamente as pedidas; qualquer diferença deixa a Central indisponível em vez de adivinhar a janela.

**Ajustes visuais (aprovados pelo Atlas).** Contagens das faixas em destaque (número grande no topo de cada aba, que continua sendo um botão clicável); estados cadastrais exibidos em português (Ativo, Inativo, Pausado, Removido; valor desconhecido aparece como veio; o dado bruto não muda); detalhe expandido sem repetição: unidades, variação e cobertura ficam só na tabela e no topo, o detalhe traz apenas fatos próprios do anúncio, hipóteses, o que é indisponível e o que conferir. Tabela compacta e conciliação expansível mantidas.
Aplicação (PR #926) usa a função `commerce_decision_units_v1`, já aplicada e validada em produção (PR #925). Rota `/api/admin/commerce/decision-center`, regras em `commerce-decision-logic.js`, tela `commerce-decision-center.jsx`. Só unidades, 7 e 30 dias, conta + ID, perda percentual e absoluta (20/60), hipóteses separadas dos fatos, situação como último estado cadastrado. Só publicar após a função ser aprovada, aplicada e validada. GA-015 a GA-017 não iniciadas.
Revisão 25/11: perda exige cobertura dos dois períodos; divergência de conciliação bloqueia classificações confirmadas; Dashboard e relatórios validados antes de usar; impressões/visitas comparadas por dia. Último dia parcial = período atual não comprovado (nada confirmado até o dia fechar).

**Validação em produção da Central (25/11/2026, após o deploy da #926).** Último dia completo por conta: 23/11 (24/11 é parcial nas três contas, comprovado pela GA-018 dia a dia). Janelas: 7 dias = 17/11–23/11 contra 10/11–16/11; 30 dias = 25/10–23/11 contra 25/09–24/10. Conciliação da função nas seis combinações: `CONCILIADA`, resíduo 0 (Shopee 7d 1597/1990; 30d 6243/4948; ML Antigo 7d 476/538; 30d 1808/1510; ML Novo 7d 79/84; 30d 349/426). A rota autenticada da tela não foi chamada por mim (exige login do dono): a validação visual das prioridades fica com o Lucas.

## GA-015 — Evolução da Curva ABC por produto (etapa 1 em rascunho)
Função `commerce_abc_units_monthly_v1` (arquivo, não aplicada) + regras puras `commerce-abc-logic.js`. Só unidades, por conta + SKU canônico; cortes 80/95 pelo acumulado anterior ao grupo, empates na mesma classe e posição competitiva; sem SKU fora do ranking; só 01/10 a 23/11/2026 tem cobertura comprovada; migração comprovada x relevante (100 un. na conta, 5/10 un. e 3 posições); conciliação GA-019/GA-021 com resíduo exatamente 0. Dashboard, Visão estratégica e Central intactos. Detalhes na seção GA-015 de `MAPA-GA.md`.

## GA-015 — etapa 2 (interface, rascunho)
Rota `/abc-evolution` + `commerce-abc-store.js` + tela "Evolução ABC" (7d/30d/mensal/anual, três contas). Função SQL ainda não aplicada: a tela mostra fonte de unidades indisponível. Só unidades; bloqueios distintos (divergente x indisponível x cobertura não comprovada); nunca confundir ausência de dado com zero vendas. GA-015A, GA-016 e GA-017 não iniciadas.

## GA-015 — revisão técnica (resumo)
Ausência em período não comprovado = SEM_INFORMACAO (nunca zero); mês incompleto = "mês até aqui" (provisório, sem migração confirmada); código parecido entrando/saindo = identidade não comprovada; migração com empate na fronteira nunca é relevante confirmada; top 10 inclui todos os empatados na 10ª posição; histórico por SKU; nomes só com vínculo; linha do gráfico interrompida em meses sem dado; função SQL com validação estrita e lista completa; orçamento de 40 requisições (histórico que não couber fica não verificado). Migração ainda NÃO aplicada.
