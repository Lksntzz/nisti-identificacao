# GA focado em anúncios com problema — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o GA mostrar anúncios ativos que pararam, caíram, convertem mal ou nunca venderam, por plataforma, com o motivo (Shopee), e reformar o Dashboard (etapas 1 e 2 do desenho).

**Architecture:** Duas funções SQL somente leitura (`commerce_problem_groups_v1`, `commerce_platform_diagnosis_v1`) calculam grupos e diagnóstico a partir da view de vendas e dos relatórios de desempenho; rota → store → tela. Regras de texto/aviso ficam em um módulo JS puro e testável. O motivo da Shopee reaproveita `commerce_listing_performance_diagnosis_v1` (já existe).

**Tech Stack:** JavaScript, React 18, Vite 8, Cloudflare Worker, Supabase Postgres (`yioetdcbgorunwgwuawg`), `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-23-ga-anuncios-com-problema-design.md` (seções 4 e 4.1 mandam nas regras). A etapa 3 (esconder os campeões) **não** faz parte deste plano.

## Global Constraints

- Unidade = **anúncio** (`external_listing_id`), nunca SKU. Grupos só com `listing_status='ACTIVE'`. Plataformas: `SHOPEE`, `ML_ANTIGO`, `ML_NOVO`.
- Valores: Em queda = média/dia **30% ou mais abaixo** da régua, baseline mínimo **10 unidades** em 3 meses; régua = média/dia dos **3 meses completos** antes da janela; Parou = vendeu antes e **0 vendas nos últimos 90 dias**; Nunca vendeu = **0 vendas desde 01/01/2025** e idade mínima **maior que 90 dias** (idade = primeiro `period_start` do anúncio em `commerce_shopee_performance_reports_v1`; sem relatório = "em teste"); Pior performance = **1.000 impressões, 100 visitantes** e conversão **abaixo de 50% da média da loja**, no relatório mais recente (aviso se terminou há **30+ dias**; grupo some com **90+**); plataforma com problema = variação **−15% ou pior**; **5** anúncios que mais pesam; janela 30/60/90 (padrão 30).
- Prioridade (um só grupo): Parou > Em queda > Pior performance > Nunca vendeu; etiqueta "também converte mal" em Em queda.
- ML: Parou e Em queda valem; Pior performance, motivo e candidato a desativar são só Shopee; ML sem venda e sem idade = contagem `SEM_IDADE`.
- Diagnóstico da plataforma conta **todo** o faturamento (inclui anúncios inativos, marcados `active:false`) e mostra a % da perda vinda de inativos.
- Ausência de dado não é zero: régua sem dados → `base_ok:false` ("sem base de comparação").
- Função SQL nova: `_v1`, `security invoker set search_path=public`, `revoke ... from public, anon, authenticated`, `grant execute ... to service_role`, só leitura. Migração salva em `supabase/migrations/` **e** aplicada manualmente. Não alterar `commerce_current_sales_listing_daily_v1`. Consulta deve rodar em bem menos de 8 s (usar CTEs materializadas se preciso).
- Só planos gratuitos; sem IA paga; texto automático por regras. Repositório público: nada de dados de negócio no código.
- `commerce-admin-router.js` tem final de linha **CRLF**: editar sem reescrever o arquivo inteiro (conferir `git diff --stat`).
- Publicar: branch nova a partir da `main`, `npm test` verde, atualizar `docs/MAPA-GA.md` e `docs/cerebro/ga.md`, PR, esperar TODOS os checks (inclusive "Chromium UI interactions"), squash, esperar "Deploy Production". Mensagens de commit terminam com as linhas de atribuição da sessão.

## Review Focus

- Anúncio ativo sem venda e fora de todos os relatórios → "em teste", nunca candidato a desativar (Task 2).
- Plataforma sem dados na régua (ML sem 2025, início do histórico) → `base_ok:false`, nunca −100% (Task 3).
- Anúncio inativo que explica a queda → aparece com `active:false` e a linha de % inativos soma certo (Task 3).
- Anúncio que atende dois grupos → aparece em um só (Task 2).
- Período que contém 11.11 ou Black Friday → aviso na tela (Task 1); filtro "ano"/"todo o histórico" → pede 30/60/90 (Task 7).

---

### Task 1: Regras puras de texto e aviso

**Files:**
- Create: `src/ga/commerce-problems-logic.js`
- Test: `test/commerce-problems-logic.test.js`

**Interfaces:**
- Produces: `GROUPS` (`[['PAROU','Parou'],['QUEDA','Em queda'],['PIOR','Pior performance'],['NUNCA','Nunca vendeu']]`); `PROBLEM_PCT = -15`; `headline(p: PlatformDiag) -> string`; `campaignWarning(start: 'AAAA-MM-DD', end: 'AAAA-MM-DD') -> string|null`; `PLATFORM_LABEL`.
- `PlatformDiag` (contrato com a Task 3): `{platform, var_pct:number|null, base_ok:boolean, lost_revenue:number, inactive_share_pct:number, top:[{title, lost_revenue, share_pct, active}]}`.

- [ ] **Step 1: Escrever testes que falham.** `headline` com `var_pct:-38, lost_revenue:12400, top` de 3 itens somando 71 → contém "ML Novo caiu 38%" e "3 anúncios explicam 71%"; com `var_pct:-3` → "sem queda"; com `base_ok:false` → "sem base de comparação"; com `inactive_share_pct:30` → menciona "30% ... não estão mais ativos". `campaignWarning('2026-11-09','2026-11-22')` contém "11.11"; `('2026-11-23','2026-11-29')` contém "Black Friday"; `('2026-09-01','2026-09-30')` é `null`.
- [ ] **Step 2: Rodar** `node --test test/commerce-problems-logic.test.js` → FALHA (módulo não existe).
- [ ] **Step 3: Implementar** as funções acima em `commerce-problems-logic.js` (Black Friday = sexta depois da 4ª quinta de novembro; 10.10 também avisa). Dinheiro formatado em pt-BR.
- [ ] **Step 4: Rodar** o teste → PASSA.
- [ ] **Step 5: Commit** `git add src/ga/commerce-problems-logic.js test/commerce-problems-logic.test.js && git commit -m "Problemas: regras de texto e aviso de campanha"`.

### Task 2: Função SQL dos grupos

**Files:**
- Create: `supabase/migrations/20261123180000_commerce_problem_groups_v1.sql`
- Test: `test/commerce-problems.test.js` (SQL lido como texto) + conferência no banco

**Interfaces:**
- Produces: `commerce_problem_groups_v1(p_days integer default 30) returns jsonb` (`p_days` fora de 30/60/90 → `raise exception`). Retorno: `{window:{start,end,base_start,base_end}, counts:{PAROU,QUEDA,PIOR,NUNCA,EM_TESTE,SEM_IDADE} por plataforma, items:[{platform, listing_id, external_listing_id, title, group, drop_pct|null, units_cur, units_base, lost_revenue, last_sale|null, age_days_min|null, also_low_conv:boolean}]}`. `counts` é um objeto `{SHOPEE:{...},ML_ANTIGO:{...},ML_NOVO:{...}}`.

- [ ] **Step 1: Escrever o teste** (`test/commerce-problems.test.js`): o SQL contém `security invoker`, `ACTIVE`, `p_days in (30,60,90)`, `revoke all on function`, `grant execute`, não contém `insert|update|delete` fora de comentários, não menciona `created_at` de `commerce_listings`.
- [ ] **Step 2: Rodar** o teste → FALHA.
- [ ] **Step 3: Escrever a migração.** Vendas só da view `commerce_current_sales_listing_daily_v1` (dias completos; hoje fica fora). Aplicar a prioridade da seção Global Constraints. Idade mínima só Shopee, via menor `period_start` do item em `commerce_shopee_performance_rows_v1`/`reports_v1`. "Pior performance" usa o relatório mais recente e a média da loja desse relatório.
- [ ] **Step 4: Rodar** o teste → PASSA.
- [ ] **Step 5: Aplicar no Supabase** (`apply_migration`) e conferir, com `execute_sql`, em 23/11/2026 (valores variam com novas importações): Shopee `PAROU`≈79, `NUNCA`≈22, `EM_TESTE`≈3, nenhum `listing_id` repetido em `items`, ML sem `NUNCA` (só `SEM_IDADE`), e tempo de `select commerce_problem_groups_v1(90)` abaixo de 5 s (medir com `explain analyze` ou cronometrando).
- [ ] **Step 6: Commit** migração e teste.

### Task 3: Função SQL do diagnóstico por plataforma

**Files:**
- Create: `supabase/migrations/20261123190000_commerce_platform_diagnosis_v1.sql`
- Test: `test/commerce-problems.test.js`

**Interfaces:**
- Produces: `commerce_platform_diagnosis_v1(p_days integer default 30) returns jsonb` → `{window, platforms:[{platform, rev_per_day_cur, rev_per_day_base, base_ok, var_pct|null, lost_revenue, rev_per_day_ly|null, ly_ok, var_ly_pct|null, inactive_share_pct, top:[{listing_id, external_listing_id, title, active, lost_revenue, share_pct}]}]}` (mesmo `PlatformDiag` da Task 1, mais campos extras).

- [ ] **Step 1: Estender o teste** com as mesmas asserções de segurança/somente leitura para este arquivo, e `base_ok` presente no SQL.
- [ ] **Step 2: Rodar** → FALHA.
- [ ] **Step 3: Escrever a migração.** Faturamento de todos os anúncios que venderam (ativos ou não); `top` = 5 maiores perdas (`active` vem de `listing_status`); `inactive_share_pct` = % da perda total vinda de inativos; `ly_ok` só se houver venda importada cobrindo o mesmo período de 2025 para a plataforma.
- [ ] **Step 4: Rodar** → PASSA.
- [ ] **Step 5: Aplicar** e conferir: ML Antigo e ML Novo com `ly_ok:false`; plataforma sem dado na régua com `base_ok:false` e `var_pct` nulo (nunca −100); soma dos `share_pct` do `top` ≤ 100.
- [ ] **Step 6: Commit.**

### Task 4: Store e rotas

**Files:**
- Modify: `src/ga/commerce-supabase-store.js` (ao lado de `commerceShopeeWhyStopped`, ~linha 213)
- Modify: `src/ga/commerce-admin-router.js` (perto de `/shopee/why-stopped`, ~linha 514; **CRLF**)
- Test: `test/commerce-problems.test.js`

**Interfaces:**
- Produces: `commerceProblemGroups(env,{days}) -> object`, `commerceProblemPlatforms(env,{days}) -> object`; rotas `GET /api/admin/commerce/problems/groups?days=30|60|90` e `GET /api/admin/commerce/problems/platforms?days=30|60|90` (outro valor → 400 "Filtro inválido. Escolha 30, 60 ou 90 dias.").

- [ ] **Step 1: Testes** (texto): store chama `commerce_problem_groups_v1` e `commerce_platform_diagnosis_v1` com `p_days`; router tem as duas rotas e `[30,60,90].includes(days)`.
- [ ] **Step 2: Rodar** → FALHA.
- [ ] **Step 3: Implementar** seguindo o molde de `commerceShopeeWhyStopped` (`supabaseRpc`, `timeoutMs:15000`, objeto vazio se resposta inválida) e de `/shopee/why-stopped`.
- [ ] **Step 4: Rodar** `node --test test/commerce-problems.test.js` e `git diff --stat src/ga/commerce-admin-router.js` (só linhas novas) → PASSA.
- [ ] **Step 5: Commit.**

### Task 5: Painel "Anúncios com problema" (etapa 1)

**Files:**
- Create: `src/ga/commerce-problems.jsx`, `src/ga/commerce-problems.css`
- Modify: `src/ga/commerce-why-stopped.jsx` (exportar `ItemCard`), `src/ga/commerce-admin-app-v2.jsx` (menu: subitem `why` passa a `label:'Anúncios com problema'`, `VIEW_TITLES.why='Anúncios com problema'`, renderiza `<CommerceProblems />`)
- Test: `test/commerce-problems.test.js`, ajustar `test/commerce-why-stopped.test.js` (regex do menu)

**Interfaces:**
- Consumes: rotas da Task 4; `GROUPS`, `headline`, `campaignWarning`, `PLATFORM_LABEL` (Task 1); `Dropdown`, `InfoIcon`, `listingUrl` de `commerce-dashboard.jsx`; `ItemCard` e o visual enxuto do "Por que parou"; para o motivo Shopee de Parou/Em queda, a rota/função de diagnóstico por anúncio já existente (`commerceListingPerformanceDiagnosis`, `commerce_listing_performance_diagnosis_v1`, até 200 ids).
- Produces: `export default function CommerceProblems()`.

- [ ] **Step 1: Testes** (texto + lógica): o componente busca `/api/admin/commerce/problems/groups?days=` e `/problems/platforms?days=`; tem seletor 30/60/90 (padrão 30); 4 cards de grupo com contagem; aviso de relatório velho (30+ dias) e grupo Pior performance oculto com 90+; texto "sem venda desde jan/2025" no grupo Nunca vendeu; contagem `SEM_IDADE` separada; menu `{ id: 'why', label: 'Anúncios com problema', view: 'why' }` abaixo de Categorias.
- [ ] **Step 2: Rodar** → FALHA.
- [ ] **Step 3: Implementar** a tela: topo com `headline` por plataforma; 4 cards-filtro (Parou, Em queda, Pior performance, Nunca vendeu); lista por grupo reutilizando `ItemCard` (resumo + 3 chips + detalhe recolhido); no ML mostrar só queda/valor, sem motivo; visual enxuto, sem texto longo aberto (o Lucas achou o painel anterior poluído).
- [ ] **Step 4: Rodar** `npm test` → PASSA.
- [ ] **Step 5: Verificar na tela** com dados reais (`npx vite build` e captura com Playwright de uma página de teste): ML Novo aparece com queda e sem motivo; Shopee com motivo.
- [ ] **Step 6: Commit.**

### Task 6: Ajustes simples do Dashboard

**Files:**
- Modify: `src/ga/commerce-dashboard.jsx` (cards `Faturamento` ~644 e `Vendendo` ~650; painel Vendas por dia ~657; `Panel` ~189), `src/ga/commerce-dashboard-charts.jsx` (`PlatformSplit` ~98)
- Test: `test/commerce-dashboard-simplify.test.js`

**Interfaces:** Consumes `Panel`, `PlatformSplit`; Produces `PlatformSplit` desenhado como pizza (SVG, fatias por plataforma, clique em fatia chama `onPick`, mesma assinatura).

- [ ] **Step 1: Testes** (texto): o Dashboard não contém `label="Faturamento"` nem `label="Vendendo"`; o painel "Vendas por dia" tem botão com `aria-expanded`; `PlatformSplit` renderiza `<svg` com `<path`.
- [ ] **Step 2: Rodar** → FALHA.
- [ ] **Step 3: Implementar.** Remover os dois cards (o total continua no cabeçalho de "Faturamento por produto"); "Vendas por dia" ganha seta que abre/fecha (aberto por padrão, estado local); `PlatformSplit` vira pizza.
- [ ] **Step 4: Rodar** `npm test` → PASSA. Conferir que as abas `best` e Curva ABC continuam funcionando (nada removido além dos 2 cards).
- [ ] **Step 5: Commit.**

### Task 7: Atenção por plataforma, Nunca vendeu e Resumo por plataforma

**Files:**
- Modify: `src/ga/commerce-dashboard.jsx` (`Panel title="Atenção"` ~744; `IndexCard label="Não vendeu"` ~653; `Panel title="Resumo do período"` ~748), `src/ga/commerce-dashboard-charts.jsx` (`SummaryList` ~135)
- Test: `test/commerce-dashboard-simplify.test.js`

**Interfaces:** Consumes rotas da Task 4 e `headline`/`campaignWarning` (Task 1). Produces: `SummaryList` passa a receber linhas por plataforma (`{platform, revenue, units, var_pct}`) e mostrar um bloco por plataforma.

- [ ] **Step 1: Testes:** "Atenção" renderiza uma linha por plataforma usando `headline`; filtro "ano"/"todo o histórico" mostra "escolha 30, 60 ou 90 dias"; card "Nunca vendeu" (rótulo novo) mostra candidatos × em teste; `SummaryList` não usa totais globais (um bloco por plataforma).
- [ ] **Step 2: Rodar** → FALHA.
- [ ] **Step 3: Implementar.** "Atenção" busca `/problems/platforms` (e `/problems/groups` para a contagem); clicar numa plataforma abre o painel Anúncios com problema nela; aviso de campanha (`campaignWarning`) acima da lista; `SummaryList` por plataforma a partir de `splitRows`/dados já carregados.
- [ ] **Step 4: Rodar** `npm test` → PASSA.
- [ ] **Step 5: Commit.**

### Task 8: Documentação, PR e produção

**Files:**
- Modify: `docs/MAPA-GA.md` (seção do painel + Dashboard), `docs/cerebro/ga.md`
- Test: `npm test`

- [ ] **Step 1: Atualizar** os dois documentos (telas, rotas, funções SQL novas, regras 4/4.1, o que foi removido do Dashboard).
- [ ] **Step 2: Rodar** `npm test` e `npx vite build` → verdes.
- [ ] **Step 3: Abrir PR** (REST via `gh api`, GraphQL é bloqueado), esperar TODOS os checks, mesclar com squash, esperar "Deploy Production" com sucesso. Conferir no Supabase que as 2 funções existem (`list_migrations`).
- [ ] **Step 4: Avisar o Lucas** com: o que mudou, números de hoje (ex.: Shopee Parou ≈79) e o que ele deve abrir para conferir.
