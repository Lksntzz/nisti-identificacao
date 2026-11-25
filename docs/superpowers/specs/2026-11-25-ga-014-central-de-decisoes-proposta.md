# GA-014 — Central de decisões comerciais — proposta para aprovação do Atlas

Data: 25/11/2026. Dono: Lucas. Estado: **PLANEJAMENTO. Nada foi implementado, publicado, migrado ou alterado.** GA-015 a GA-017 não iniciadas.
Diagnóstico feito só com leitura (código, docs e consultas SELECT no banco, em 25/11/2026).

## 1. Intenção

Transformar os indicadores que já existem em uma fila de prioridades **por conta** (Shopee, ML Antigo, ML Novo; nunca Consolidado), ordenada pelo **impacto em unidades vendidas**. Não é outro Dashboard: cada linha responde "por que este anúncio está na fila, o que é fato, o que é hipótese, o que não sei e o que investigar". O GA **não altera nenhum anúncio** e **não mostra nenhum indicador financeiro**.

## 2. Diagnóstico das fontes

Hoje = 25/11/2026. "Idade" = dias desde o fim do período ou da última verificação.

| Fonte | Nível | Contas | Estado real | Confiança |
|---|---|---|---|---|
| Vendas por anúncio/dia (`commerce_current_sales_listing_daily_v1`, GA-019/GA-021) | anúncio | 3 | até 24/11; Shopee desde 01/2025, ML desde 01/2026 | **Alta para unidades.** Dia atual incompleto |
| Cobertura de vendas (GA-018) | período | 3 | completa só de 01/10 em diante; último dia completo 23/11 | **Alta.** Hoje: período atual comprovado em 7 e 30 dias; anterior só em 7 dias |
| Desempenho Shopee (visitantes, impressões, cliques, conversão) | anúncio | Shopee | 6 relatórios; último 16–22/11 (3 dias); 141 de 141 anúncios que venderam em 30 dias estão nele | **Alta e atual**, mas cada relatório cobre ~7 dias (período diferente do atual) |
| Desempenho ML | anúncio | ML Novo | 1 relatório, 01/01–27/10 (29 dias de idade); 39 de 40 anúncios que venderam | **Desatualizado**: não serve como evidência do período atual |
| Desempenho ML | anúncio | ML Antigo | **nenhum relatório** | Indisponível |
| Anúncios patrocinados Shopee | anúncio | Shopee | 2 relatórios, último até 20/10 (36 dias); traz gasto/GMV | **Desatualizado** e financeiro: fora da GA-014 |
| Tráfego manual por anúncio | anúncio | — | 0 registros | Indisponível |
| Estoque | variação | Shopee | só "foto do catálogo" de 17/11 (442 variações), declarada não real e sem tempo real; ML: sem informação | **Não confiável para afirmar falta ou excesso de estoque** |
| Preço de tabela | variação | Shopee | foto do catálogo de 17/11 sem data própria; ML: não importado | **Não confiável**. Preço realizado (receita ÷ unidades) é derivado de dinheiro: fora |
| Situação do anúncio (ativo/inativo) | anúncio | 3 | verificada em 16–17/11 (8–9 dias); ML Antigo 249 ativos, ML Novo 237, Shopee 285 (+1 não ativo) | Média: pode ter mudado desde então |
| Idade do anúncio | anúncio | Shopee | só pelo primeiro relatório de desempenho em que aparece; ML sem fonte | Parcial |
| "Por que parou" (Shopee, SQL existente) | anúncio | Shopee | compara 2 relatórios sem sobreposição: visibilidade, clique, conversão; só com volume mínimo (1.000 impressões, 100 visitantes) | Boa como **hipótese**, limiares já definidos |
| Visão estratégica (GA-013) | agregado + listas | 3 | listas com teto do banco (campeões 10, crescimento 10, queda 20, pararam 300, sem venda 1000); a queda é ordenada por **valor de venda perdido**, não por unidades | Serve de base de regras, **não** de fila por unidades |
| `commerce_problem_groups_v1`, `commerce_platform_diagnosis_v1`, `commerce_sales_velocity_v2` | anúncio/produto | 3 | ordenam ou trazem faturamento; velocidade tem cobertura própria (≠ GA-018) | Não usar como fonte de prioridade |

**Lacuna central:** não existe, sem migração, uma fonte com unidades **por anúncio, período atual × anterior, para todos os anúncios da conta**, ordenável por unidades. Esse é o ponto que decide a arquitetura (seção 5).

**Fontes novas que seriam necessárias (não propostas agora):** estoque real e datado; preço atual datado; relatório de desempenho do ML Antigo e ML Novo atualizado; situação do anúncio atualizada (pausado, reprovado, sem estoque); patrocinados atualizados e sem valores em dinheiro.

## 3. Regras objetivas de priorização

Unidade de análise: **anúncio** (conta + ID; nunca cruza contas). Só unidades.
Janelas: 7 e 30 dias (60 e 90 ficam só como "dados insuficientes", pois a cobertura não é comprovada). **Padrão: 7 dias**, a única com período atual e anterior comprovados hoje.
Impacto: `Δ = unidades do período anterior − unidades do período atual` (positivo = perda; negativo = ganho). Empate: maior unidade anterior, depois ID.
Limiares (reaproveitam os da "Por que parou"): queda/alta de **30%** ou mais; Δ mínimo **L1 = 5 un (7 dias) / 10 un (30 dias)** para alta; **L2 = 2 / 4** para revisão.

Faixas (cada anúncio cai em uma só, na ordem abaixo):

1. **Dados insuficientes** — qualquer um: período atual ou anterior sem cobertura comprovada; anúncio inativo ou sem cadastro com venda; mesmo ID repetido nas duas contas ML; base anterior menor que L2. Mostra "possível queda/parada (não confirmada)" com o que falta comprovar. Nunca vira alta.
2. **Prioridade alta** — cobertura atual **e** anterior comprovadas, anúncio ativo, **parou ou caiu ≥30%** com **Δ ≥ L1**. Ordem: Δ decrescente.
3. **Precisa de revisão** — mesmas condições, com **L2 ≤ Δ < L1**. Ordem: Δ decrescente.
4. **Oportunidade** — cobertura comprovada, ativo, **alta ≥30% com ganho ≥ L1** (fato: o que está dando certo). Na Shopee, também **hipótese**: visitantes ≥100 e conversão abaixo de 50% da média da loja no relatório mais recente (regra já usada hoje). Ordem: ganho; hipóteses de conversão por visitantes. **Sem projeção de unidades** que não seja medida.

Simulação grosseira com dados reais (período atual 17–23/11, anterior 10–16/11, ativos), só para dimensionar a fila:

| Conta (7 dias) | Alta | Revisão | Oportunidade (alta de vendas) | Queda pequena ignorada |
|---|---|---|---|---|
| Shopee | 16 (271 un perdidas) | 22 | 5 | 25 |
| ML Antigo | 6 (74 un) | 12 | 2 | 10 |
| ML Novo | 1 (5 un) | 1 | 1 | 7 |

Em 30 dias a mesma conta daria Shopee 7/9, ML Antigo 4/5, ML Novo 5/4, **mas o período anterior não está comprovado**: todos iriam para "dados insuficientes (candidatos)". Os números finais dependem da implementação e da cobertura no dia.

## 4. Fato, hipótese, indisponível

Cada linha expandida traz três blocos, sempre com datas:

- **Fato (comprovado):** unidades atual e anterior, datas dos dois períodos, cobertura (GA-018), última venda importada, situação cadastrada (com data da verificação).
- **Hipótese (rotulada, nunca "causa"):** só quando há relatório da MESMA conta, com volume mínimo e idade ≤ 14 dias, e mostrando o período do relatório ("16–22/11, diferente do período atual"). Ex.: "impressões por dia caíram 35% entre 2 relatórios: pode indicar perda de visibilidade". Hoje só Shopee.
- **Indisponível (com motivo):** estoque ("fonte é foto do catálogo, não estoque real"), preço ("sem fonte datada"), tráfego/conversão ("ML Antigo: sem relatório; ML Novo: relatório de 27/10, antigo demais"), idade do anúncio no ML.
- **Investigação recomendada:** roteiro do que **conferir manualmente** no painel do marketplace, escolhido pelo padrão de evidência (ex.: queda + visibilidade caiu → "conferir posição na busca, campanhas e categoria"; queda sem relatório → "conferir estoque, preço, situação e reputação; o GA não tem esses dados"). Texto de verificação, nunca de ação ou de afirmação.

Proibido em teste (como na GA-013): palavras e campos de faturamento, lucro, margem, ticket, preço; frases que afirmem estoque, preço, tráfego ou conversão como causa sem evidência; qualquer rota de escrita.

## 5. Abordagens

| | Como | Prós | Contras |
|---|---|---|---|
| **A. Só o que existe** (listas da GA-013) | Reaproveitar listas atuais | Sem banco | Tetos de 10/10/20; queda ordenada por valor, não por unidades; **não atende** o requisito |
| **B. Nova função SQL somente leitura (recomendada)** | `commerce_decision_units_v1(plataforma, 2 períodos)` devolve por anúncio: unidades atual/anterior, última venda, situação; sem receita; `stable`, `service_role`, reaproveitando a view e a GA-018 | Correta, rápida, ordenável por unidades, sem cópia de regra | Exige migração (arquivo + autorização do Lucas; aplicada só depois de revisão) |
| **C. Ler a view por REST paginado** | Worker lê ~400 anúncios × 14 dias (7 dias) ou × 60 dias (30 dias) | Sem migração | Várias páginas por chamada, mais lento, helper novo no Worker, mais exposto a erro |

Recomendação: **B**, em duas PRs: (1) lógica pura + tela + rota usando um contrato definido e testado com dados fictícios; (2) a migração, só como arquivo, com a mesma disciplina das GA-018/GA-021 (teste no Postgres local, revisão, aplicação autorizada). Se o Atlas recusar migração, **C** com janela de 7 dias.

Desenho técnico (igual ao padrão da GA-013): rota `GET /api/admin/commerce/decision-center?platform=&days=7|30` (valida conta e período, `no-store`, sem cache de leitura); módulo puro `commerce-decision-logic.js` (faixas, limiares, fato/hipótese/indisponível, textos); tela `commerce-decision-center.jsx` nova, item de menu "Central de decisões" depois de "Visão estratégica". Cobertura via GA-018; evidências de desempenho só da mesma conta, por ID; resposta com plataforma e janela conferidas (descartada se não bater, como na GA-012). Dashboard e Visão estratégica **não mudam**. Testes: unidade das regras (inclusive empates, cobertura parcial, ID repetido), contrato com formatos reais copiados do banco, termos proibidos, "nenhuma rota de escrita", navegador real (troca rápida de conta, falhas parciais).

## 6. Proposta visual

```
Central de decisões   [Shopee | ML Antigo | ML Novo]   Período: [7 dias ▾]   30 dias (candidatos)
Somente leitura: o GA não altera anúncios.
Fontes:  Vendas até 24/11 ✔ cobertura 7 dias   Desempenho Shopee 16–22/11   Estoque: indisponível   Preço: indisponível
┌ Prioridades altas 16 ┬ Precisa de revisão 22 ┬ Oportunidades 5 ┬ Dados insuficientes 38 ┐
│ #  Anúncio                    Unidades            Impacto     Motivo                    │
│ 1  Caderno Scrapbook…         18 → 6              −12 un      Queda de 67% confirmada   │
│    ▸ Fatos · Hipóteses · Indisponível · O que conferir                                  │
```

Mesmo estilo visual do GA (cartões, azul `#2a78d6`, cinza `#64748b`). Faixas como abas com contagem; linha compacta com impacto em unidades em destaque; detalhe expansível; avisos essenciais sempre visíveis fora do detalhe (cobertura não comprovada, relatório antigo). Lista com teto de 50 por faixa e contagem total quando maior, sem esconder o teto.

## 7. Riscos e limites honestos

- Janela de 7 dias é ruidosa; por isso os limiares mínimos e a hipótese nunca é chamada de causa.
- Hoje só 7 dias é confirmável; 30/60/90 ficam como candidatos até haver cobertura (importar relatórios completos de setembro e anteriores).
- Situação do anúncio tem 8–9 dias; pode estar defasada.
- ML Antigo não tem evidência nenhuma de tráfego; ML Novo só antiga. A fila do ML será majoritariamente fatos de venda.
- Anúncios inativos que ainda vendem e IDs repetidos entre as contas ML (pendência conhecida do SQL de desempenho) vão para "dados insuficientes".
- Queda "confirmada" é de **vendas importadas**, não prova a causa nem o estado real no marketplace.

## 8. Decisões pedidas ao Atlas

1. Abordagem B (função SQL nova, migração só como arquivo e aplicada depois) ou C (REST, 7 dias)?
2. Padrão de 7 dias e limiares 30% / L1 5-10 / L2 2-4 estão adequados?
3. Oportunidades por conversão baixa (hipótese) entram, ordenadas por visitantes e sem projeção de unidades?
4. Idade máxima do relatório para hipótese: 14 dias?
5. Autorizar depois, como etapas separadas, novas fontes (desempenho ML atualizado, estoque e preço datados)?
