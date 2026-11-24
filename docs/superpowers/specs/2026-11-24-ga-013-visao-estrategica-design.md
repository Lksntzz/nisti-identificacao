# GA-013 — Visão estratégica individual — desenho

Data: 24/11/2026. Dono: Lucas (leigo em programação; fala português). Sistema: GA (Gestor de Anúncios). Leia antes `CLAUDE.md` e `docs/MAPA-GA.md`. Retomada autorizada pelo Lucas depois da GA-021 publicada e validada pelo Atlas.

## 1. Intenção

Uma tela **por conta** (Shopee, ML Antigo, ML Novo; nunca Consolidado) que diga, em linguagem simples, como a conta está vendendo, **em unidades**, e quais anúncios merecem atenção. A tela só lê; não grava, não desativa, não edita.

## 2. Metas, não-metas, anti-metas

Metas
- Mostrar: unidades vendidas (período e período anterior), situação dos anúncios, produtos campeões, evolução comercial (mensal e dos últimos dias), categorias e coleções.
- Identificar **crescimento, queda, anúncios que pararam e anúncios que nunca venderam**, mas só quando a cobertura de vendas comprovada permitir.
- Mostrar visitas, impressões e conversão **somente** quando houver relatório de desempenho importado da MESMA conta.
- Separar, na Shopee, venda total, vinculada, sem vínculo e resíduo não explicado (GA-021); no ML, anúncios vendendo sem SKU vinculado.
- Permitir ver o **histórico não verificado**, sempre com a limitação escrita na tela.

Não-metas
- Nenhum faturamento, lucro, margem ou ticket médio, em tela, na resposta da rota ou nos testes de contrato.
- Não mexer no Dashboard atual (`commerce-dashboard.jsx` e telas existentes ficam como estão).
- Não alterar GA-018 (Qualidade dos dados), GA-019, GA-021 nem o isolamento por conta da GA-012.
- Não começar GA-014 a GA-017. Não aplicar migração (esta etapa **não precisa de migração**).

Anti-metas (seria fracasso mesmo funcionando)
- Chamar de "queda" ou "parou" um período que não tem cobertura comprovada.
- Misturar contas: o ID de anúncio pode existir na Shopee e no ML; cada linha só usa dados da PRÓPRIA conta.
- Tela poluída: poucos blocos, uma pergunta por bloco.

## 3. Abordagens consideradas

A. **Nova função SQL** que calcula tudo. Prós: um lugar só. Contras: exigiria migração e revisão do banco; duplicaria regras que o overview já tem; mais risco sobre a view que alimenta todas as vendas.
B. **Montar no Worker a partir das funções que já existem** (overview, dashboard, mensal, série, categorias, qualidade GA-018, divisão da GA-021, relatórios de desempenho) e aplicar as regras de cobertura em código puro e testável. Prós: sem migração, sem risco de dados, regras testáveis sem banco. Contras: listas já vêm limitadas pelas funções (top 10 campeões, 10 em crescimento, 20 em queda, 300 parados, 1000 sem venda); várias chamadas por tela.
C. Estender o Dashboard atual. Descartada: o pedido é preservá-lo integralmente.

**Escolhida: B.** Se o Lucas quiser listas completas (todos os anúncios classificados), uma função SQL nova vira etapa seguinte, com migração só como arquivo.

## 4. Regras de cobertura (o coração da etapa)

Períodos, vindos do próprio Dashboard (`commerce_dashboard_v1`): atual = `current_start` a `last_day`; anterior = `previous_start` até o dia antes de `current_start`. `last_day` é o último dia importado antes de hoje, então o dia parcial de hoje não entra.

A cobertura de um período está **comprovada** quando a GA-018 da MESMA conta e do MESMO período devolve cobertura COMPLETA, todos os dias completos, nenhum parcial, nenhum dia sem informação, nenhum registro não verificado e nenhum intervalo faltando (função `coverageProven`, a mesma já usada na GA-012).

| Rótulo | Exige |
|---|---|
| Crescimento / Queda / Estável | cobertura comprovada do período atual **e** do anterior |
| Parou | cobertura comprovada do período atual (a última venda antiga pode ser histórico não verificado e é avisada como tal) |
| Nunca vendeu | cobertura comprovada de TODO o histórico importado (do primeiro ao último dia) |
| Campeões e unidades | sempre aparecem; recebem selo "não verificado" quando o período não está comprovado |

Sem cobertura: o item aparece como **"Sem classificação"** com o motivo (qual período falta), nunca como queda, parada ou "zero vendas". Ausência de informação (nada importado) é diferente de cobertura não comprovada, que é diferente de zero vendas comprovado.

Hoje (24/11/2026) só há cobertura comprovada de 01/10/2026 em diante; por isso 7 dias classifica, 30 dias não (o período anterior começa antes de 01/10) e "nunca vendeu" não é afirmado. Isso é o comportamento correto, não um defeito: a tela explica e mostra o histórico não verificado.

Limiares de classificação (mesmos do Dashboard, para não divergir): crescimento = anterior ≥ 5, atual ≥ 10 e variação ≥ +15%; queda = anterior ≥ 5 e variação ≤ −15%; o restante com venda nos dois períodos é estável.

## 5. Dados e separação de vendas

- Fontes de vendas: a view da GA-019 (`commerce_current_sales_listing_daily_v1`, por anúncio) e a fonte da GA-021 (total por SKU, usada por Categorias e coleções).
- Shopee: `commerce_shopee_sales_link_split_v1` para o período atual devolve total, vinculada, sem vínculo e resíduo; o resíduo não explicado aparece à parte e nunca é somado a "sem vínculo". Se a identidade não fecha, o status é mostrado como inconsistente.
- ML: sem divisão total x vinculada (o ML lê só a base por anúncio); mostra quantos anúncios vendem sem SKU vinculado.
- Visitas, impressões e conversão: relatórios de desempenho já importados (`perfItemFor`), por plataforma e conta, com o período do relatório escrito. Sem relatório da conta: "Sem informação", nunca zero. A conversão exibida é a calculada no relatório (pedidos ÷ visitas), não é vendas ÷ visitas misturado.
- Evolução: série mensal (`commerce_dashboard_monthly_v1`) e dos últimos dias (`commerce_dashboard_series_v2`), só unidades.
- Categorias e coleções: `commerce_categories_v2` em janela de dias; só unidades (campos de faturamento removidos na rota).

## 6. Rota e arquivos

- Rota nova `GET /api/admin/commerce/strategic-view?platform=SHOPEE|ML_ANTIGO|ML_NOVO&days=7|30|60|90`. Fora do prefixo `sales-dashboard/`, portanto **sem cache de borda** (a cobertura da GA-018 nunca é cacheada). `TODAS` é recusada.
- `src/ga/commerce-strategic-logic.js`: regras puras (sem rede, sem React).
- `src/ga/commerce-supabase-store.js`: `commerceStrategicViewV1` reúne as partes em paralelo; parte que falhar vira "indisponível" na tela, sem derrubar o resto.
- `src/ga/commerce-strategic-view.jsx` e `.css`: tela. Entrada "Visão estratégica" no menu lateral, depois de Dashboard.
- Garantia de privacidade: o montador remove de qualquer resposta chaves de faturamento/lucro/margem/ticket e um teste percorre a resposta inteira procurando por elas.
- Isolamento (GA-012): a tela guarda cada resposta com a chave da conta pedida e descarta a que chegar de outra conta.

## 7. Testes (todos com dados fictícios)

Regras puras: cobertura por período, cada rótulo com e sem cobertura, limiares, "nunca vendeu" só com histórico comprovado, separação sem vínculo x resíduo x inconsistente, visitas/conversão só da própria conta, ausência nunca vira zero, remoção de campos comerciais, conta A nunca recebe dado da conta B. Rota/store: validação, `TODAS` recusada, sem cache, parte que falha. Tela: sem termos proibidos, selo de histórico não verificado, entrada no menu, Dashboard intacto (arquivo do Dashboard sem diferença nesta PR).

## 8. Fora desta etapa

Lista completa de anúncios classificados (exigiria função SQL), coluna por anúncio de visitas dentro de categorias, qualquer ação sobre anúncios, GA-014 a GA-017.
