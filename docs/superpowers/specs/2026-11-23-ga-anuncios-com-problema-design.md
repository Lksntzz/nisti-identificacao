# GA focado em anúncios com problema — desenho

Data: 23/11/2026. Dono: Lucas (leigo em programação; fala português). Sistema: GA (Gestor de Anúncios, `ga.sistemanistiid.online`), dentro do repositório `nisti-identificacao`. Leia antes `CLAUDE.md`, `docs/cerebro/INDEX.md` e `docs/cerebro/ga.md`.

## 1. Intenção e porquê

Hoje o GA destaca quem vende bem (Mais vendidos, Em alta, top 15 por faturamento, Curva ABC). O Lucas quer o oposto: o GA deve trabalhar com os **anúncios que não vendem como antigamente** e dizer **por quê**. O dia ideal dele: abrir o GA, ver qual plataforma está mal e qual anúncio está puxando a queda, e saber se o motivo é exposição da plataforma, imagem/título (CTR), preço ou conversão. Ele também quer saber quais anúncios nunca venderam (candidatos a desativar) e quais vendiam bem e pararam.

O GA **só sugere**: não está ligado à Shopee nem ao Mercado Livre e não desativa nada. O Lucas age nas plataformas.

## 2. Metas, não-metas, anti-metas

Metas
- Quatro grupos de anúncios com problema, com contagem e motivo provável.
- Por plataforma (Shopee, ML Antigo, ML Novo): quanto caiu e quais anúncios explicam a queda.
- Texto automático curto que resume isso (regras, não IA).
- Dashboard reformado (seção 6).

Não-metas
- Não usar IA paga nem qualquer serviço com custo (regra do projeto: só planos gratuitos).
- Não desativar, editar ou apagar anúncios nem dados.
- Não explicar o motivo no Mercado Livre agora: não existe relatório de desempenho do ML no sistema. No ML o GA mostra só **quais anúncios caíram e quanto**.
- Não guardar histórico de mudanças de título/foto/preço do anúncio nesta fase (ver seção 8).

Anti-metas (seria fracasso mesmo funcionando)
- Lista enorme de alertas sem prioridade (hoje 207 dos 303 anúncios ativos da Shopee não tiveram pedido na semana; 191 desses têm menos de 1.000 impressões).
- Alarme falso por sazonalidade (11.11, Black Friday, agenda de ano antigo) ou por anúncio com pouco volume.
- Quebrar a Curva ABC, as importações ou a view `commerce_current_sales_listing_daily_v1` (alimenta todas as telas de vendas).

## 3. Decisões do Lucas (valem como estão)

1. **A unidade é o anúncio** (`external_listing_id`), nunca o SKU. SKU antigo ou novo não muda a regra; não existe grupo "substituídos".
2. **Só anúncios ativos** (`listing_status='ACTIVE'`).
3. **Quatro grupos:** Parou, Em queda, Pior performance, Nunca vendeu.
4. **Nunca vendeu:** ativo, mais de 90 dias, sem nenhuma venda → candidato a desativar. Mais novo que 90 dias → "em teste". Se vendeu antes e parou → é "Parou", não "Nunca vendeu".
5. **"Antigamente" tem duas réguas:** a média dos últimos meses e o mesmo período do ano passado.
6. **Abordagem A:** uma função SQL nova faz o cálculo; o Dashboard e o painel só a chamam.
7. **Etapas:** (1) função + painel dos 4 grupos; (2) ajustes do Dashboard; (3) esconder os campeões, só se o Lucas confirmar depois.
8. Quer começar pela Shopee (única com dados de motivo).

## 4. Definições (as marcadas "chamada minha" são propostas do redator, não decididas pelo Lucas)

Período: o do filtro do Dashboard (30/60/90 dias, mês, ano). "Dias completos": o dia de hoje fica de fora, como no painel "Por que parou".

**Réguas de comparação** (por anúncio e por plataforma, sempre em média por dia):
- Régua principal: média por dia dos **3 meses completos anteriores** ao período. (chamada minha: 3 meses)
- Régua secundária: **mesmo período de 2025**, só quando houver venda importada cobrindo esse período para a plataforma. Ausência de dado não é zero (ML 2025 nunca foi importado; Shopee tem dados desde 01/01/2025).
- A comparação com o período anterior de mesmo tamanho (já existente no Dashboard) continua disponível.

**Grupos** (todos sobre anúncios ativos):
- **Parou:** já vendeu antes (histórico importado) e **zero vendas nos últimos 90 dias**. Regra do Lucas.
- **Em queda:** ainda vende, mas a média por dia no período está **30% ou mais abaixo** da régua principal. Volume mínimo para evitar ruído: baseline de pelo menos 10 unidades nos 3 meses. (chamada minha: 30% e 10 unidades). Recebe a etiqueta "também abaixo de 2025" quando a régua secundária existe e está 30% ou mais abaixo.
- **Pior performance (Shopee):** a partir do relatório de desempenho mais recente: 1.000 ou mais impressões **e** 100 ou mais visitantes **e** conversão (pedidos ÷ visitantes) abaixo da metade da média da loja. Ordenar por impressões "desperdiçadas". (chamada minha). Hoje dá cerca de 16 anúncios.
- **Nunca vendeu:** zero vendas em todo o histórico importado e idade maior que 90 dias. **Idade:** o GA não tem data real de criação (a coluna `created_at` de `commerce_listings` é a data de entrada no GA, outubro/novembro). Usar como idade mínima a **primeira vez que o anúncio aparece em um relatório de desempenho** (`commerce_shopee_performance_reports_v1`, período mais antigo). Anúncio que não aparece em nenhum relatório = idade desconhecida → tratar como "em teste", nunca como candidato. Hoje: 25 nunca venderam; 22 aparecem há mais de 90 dias; 14 desses têm quase nenhuma impressão.

Números de referência medidos em 23/11/2026 (Shopee, 285 ativos): 181 venderam nos últimos 90 dias; 79 venderam antes e não nos últimos 90 dias; 25 nunca venderam.

**Motivo provável (só Shopee):** reaproveitar as regras do painel "Por que parou" (`commerce-why-stopped-logic.js`, função `commerce_shopee_why_stopped_v1`): impressões/dia → visibilidade; CTR → cliques (imagem, título, preço na lista); pedidos ÷ visitantes → conversão (preço, frete, avaliações); preço médio vendido +10% → "Preço subiu". Etapa só conta com 1.000 impressões e 100 visitantes nos dois relatórios. É pista, não veredito. Hoje o relatório mais novo é o de 16–22/11 e o anterior sem sobreposição é 06/10–04/11.

**Diagnóstico por plataforma:** para cada plataforma: faturamento por dia no período vs. régua principal (e vs. ano passado quando existir), variação em %, valor perdido em R$, e os **5 anúncios que mais pesam na perda** com a parte (%) de cada um. Plataforma "com problema" quando a variação for -15% ou pior (chamada minha).

**Texto automático (regras):** uma frase por plataforma, por exemplo "ML Novo caiu 38% (R$ 12,4 mil a menos). 3 anúncios explicam 71%." ou "ML Antigo sem queda". Sem IA. Quando a comparação incluir 11.11 ou Black Friday, mostrar aviso de que o período contém campanha.

### 4.1 Regras de borda (chamadas do redator, fechadas depois da revisão do desenho)

- **Quais plataformas entram em cada grupo.** **Parou** e **Em queda** usam só vendas, então valem para **Shopee, ML Antigo e ML Novo** (o ML Novo foi onde as vendas despencaram, então não pode ficar de fora). **Pior performance** e o **motivo provável** são só Shopee (dependem do relatório de desempenho). **Nunca vendeu** é só Shopee nesta fase: no ML não existe fonte de idade do anúncio, então anúncio de ML ativo e sem nenhuma venda aparece em contagem separada, "sem venda, idade desconhecida", e **nunca** como candidato a desativar. Se o Lucas achar uma data de criação no export do ML, isso muda numa fase futura.
- **Diagnóstico da plataforma conta todo o faturamento**, inclusive de anúncios já inativos ou removidos (é o dinheiro real da plataforma). Os "5 anúncios que mais pesam" saem de todos os anúncios que venderam; os que não estão mais ativos aparecem marcados "inativo". Mostrar uma linha "X% da queda vem de anúncios que não estão mais ativos". Os **grupos** (Parou, Em queda, Pior performance, Nunca vendeu) usam só anúncios ativos.
- **Janela de tempo.** O diagnóstico por plataforma (pizza/Atenção) segue o filtro do Dashboard quando ele é 30/60/90 dias ou um mês. Para "ano" ou "todo o histórico" mostra "escolha 30, 60 ou 90 dias" (como o card Em queda já faz hoje). Os grupos do painel novo têm seletor próprio de 30/60/90 dias (padrão 30), com régua = 3 meses completos antes da janela. **Parou** e **Nunca vendeu** usam sempre 90 dias fixos. Régua sem dados (início do histórico, plataforma sem esse período) mostra "sem base de comparação", nunca zero.
- **Cada anúncio fica em um só grupo**, por prioridade: Parou, depois Em queda, depois Pior performance, depois Nunca vendeu. Anúncio que cai e também converte mal fica em "Em queda" com a etiqueta "também converte mal". Assim as contagens somam sem repetir.
- **"Nunca vendeu" é "sem venda desde 01/01/2025".** O histórico começa em 01/01/2025; um anúncio que só vendeu antes disso pareceria "nunca vendeu". A tela escreve "sem venda desde jan/2025" e trata sempre como sugestão a conferir na plataforma, nunca como veredito.
- **Pior performance usa o relatório de desempenho mais recente.** Se o relatório terminou há mais de 30 dias, mostra o aviso "relatório de N dias"; se terminou há mais de 90 dias, o grupo some e aparece só o pedido de importar um relatório novo.

## 5. Abordagens consideradas

- **A (escolhida): função SQL nova** (`commerce_*_v1`) que calcula tudo e é lida pelo Dashboard e pelo painel. Prós: fonte única, testável, serve às duas telas, alcança a régua do ano passado. Contra: risco de consulta pesada; o banco já deu timeout de 8 s com a função `commerce_sku_pattern_v1`, que precisou de CTEs materializadas. Mitigação: cache de leitura de 5 min (já existe), fila de leituras do navegador (máx. 3 simultâneas) e testar tempo antes de ligar.
- **B: tabela de resumo recalculada a cada importação.** Leitura instantânea, mas mexe no fluxo de importação (a parte mais delicada). Fica como evolução se A ficar lenta.
- **C: calcular no navegador.** Lento, duplica regra, não alcança o ano passado. Descartada.

Escolhida A com o Lucas.

## 6. O que muda no Dashboard (etapa 2)

Mapeamento feito sobre `src/ga/commerce-dashboard.jsx`:
1. Remover o card **Faturamento** da linha de KPIs (`KpiCard label="Faturamento"`). O total continua no cabeçalho de "Faturamento por produto".
2. **Vendas por dia**: o painel passa a abrir/fechar com uma seta.
3. **Faturamento por plataforma** (`PlatformSplit`): vira gráfico de pizza.
4. **Atenção**: deixa de ser lista de alertas e vira o diagnóstico por plataforma (seção 4), com clique abrindo os anúncios que mais pesam.
5. Remover o card **Vendendo** (`IndexCard label="Vendendo"`, que abria a aba `best`).
6. Card **Não vendeu** vira **Nunca vendeu**, com a regra da seção 4 (candidatos a desativar × em teste).
7. **Resumo do período** (`SummaryList`, hoje global) vira um bloco por plataforma.

Permanecem por enquanto (o Lucas não citou): Faturamento por produto (top 15), Em alta, Curva ABC, aba Mais vendidos. Destacam os melhores; a etapa 3 decide.

## 7. Restrições

- JavaScript sem TypeScript; React 18 + Vite; Cloudflare Worker; Supabase Postgres (`yioetdcbgorunwgwuawg`). O navegador nunca fala com o banco: tela → `/api/admin/commerce/...` → router (`commerce-admin-router.js`, **final de linha CRLF**) → `commerce-supabase-store.js` → função SQL.
- Função SQL nova: `_v1`, `security invoker set search_path=public`, `revoke ... from public, anon, authenticated`, `grant execute ... to service_role`. Só leitura. Migração salva em `supabase/migrations/` **e** aplicada manualmente no Supabase (o deploy não aplica).
- Só planos gratuitos. Nada que gere custo.
- Não mudar a view `commerce_current_sales_listing_daily_v1`; usá-la como está.
- `npm test` verde; atualizar `docs/MAPA-GA.md` e `docs/cerebro/ga.md` no mesmo PR; branch nova, PR, esperar todos os checks (incluindo "Chromium UI interactions"), mesclar com squash, esperar "Deploy Production".
- Repositório público: nada de dados de negócio no código.
- Painel "Por que parou" existe e está em produção; reaproveitar seu código e suas regras em vez de duplicar.

## 8. Limitações conhecidas

- Mercado Livre: sem relatório de desempenho → sem "motivo". O relatório do ML não baixa pela conta do Lucas (falha do lado do ML).
- Imagem e título não se separam: o relatório só mostra CTR. O GA dirá "CTR baixo: confira foto, título e preço na lista".
- Dizer "o título mudou em tal dia" exigiria guardar uma foto semanal do anúncio (título, preço, imagem principal); não existe hoje e fica fora desta fase.
- O relatório de desempenho da Shopee é importado à mão pelo Lucas; sem relatório recente o motivo compara períodos antigos (o painel já avisa quando o relatório termina antes da queda).
- Sazonalidade: agenda de ano antigo e picos de campanha podem gerar queda "normal"; por isso a régua de 3 meses, o volume mínimo e o aviso de campanha.

## 9. Deixado ao construtor

Nome da função SQL e forma exata do JSON; layout fino dos cards; como paginar listas grandes; textos exatos; ordenação dentro dos grupos; testes; como medir e ajustar o tempo da consulta; se o painel novo substitui ou amplia o "Por que parou" (recomendação: ampliar, mantendo o nome do item de menu ou renomeando para "Anúncios com problema").
