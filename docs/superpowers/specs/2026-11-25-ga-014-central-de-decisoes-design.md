# GA-014 — Central de decisões comerciais (design revisado)

Arquitetura B aprovada pelo Atlas: função SQL somente leitura `commerce_decision_units_v1` (PR de migração, só arquivo) + aplicação que classifica no servidor. Proposta original: `2026-11-25-ga-014-central-de-decisoes-proposta.md` (PR de migração).

## Os 10 ajustes e onde estão
1. Prioridade por perda percentual **e** absoluta (20 un/7d, 60 un/30d). Impacto medido (dados reais, 7d): Shopee +3 anúncios só pelo absoluto (113 un); ML Antigo e ML Novo, nenhum. 30d: nenhum nas três contas.
2. Saída de zero/base pequena entra como oportunidade, sem percentual (`pct_change` nulo).
3. "Sem prioridade comercial" separado de "dados insuficientes".
4. Identidade conta + ID; só atribuição realmente ambígua é descartada (e apenas título/situação).
5. Hipóteses de conversão em faixa própria; relatórios comparáveis (mesma conta, ≤14 dias, volume mínimo); sem projeção.
6. Situação = "Último estado cadastrado" + data.
7. 7 e 30 dias; classificação dinâmica pela cobertura.
8. Conciliação com Dashboard e GA-021; vendas sem vínculo identificadas, não distribuídas; totais antes do limite de 50.
9. Sem indicadores financeiros; preço/estoque só como indisponível/conferência manual.
10. Função SECURITY INVOKER, `search_path` explícito, acesso só `service_role`; validações de conta, períodos, duplicidades e desempenho cobertas em `test/db/commerce-decision-units.db.test.js`.

## Riscos conhecidos
- 7 dias é ruidoso: queda pequena em base pequena não deve ser lida como tendência.
- Relatórios do ML estão defasados (Novo até 27/10; Antigo sem relatório): hipóteses de conversão ficam indisponíveis nessas contas.
- Anúncios do ML com variações têm linhas duplicadas no relatório: marcados como ambíguos, nunca somados.

## Revisão técnica de 25/11/2026 (PRs #925 e #926)
Limiares absolutos (20 un em 7 dias, 60 em 30) **aprovados pelo Atlas**; demais critérios mantidos.

### Simulação com as janelas EXATAS do Dashboard (7 dias: 18–24/11 contra 11–17/11; 30 dias: 26/10–24/11 contra 26/09–25/10)
Contagens só pelas regras de unidades (sem aplicar situação cadastrada nem cobertura). "Só absoluta" = entra em alta apenas pelo limiar de 20 / 60 un.

| Janela | Conta | Alta (total) | só percentual | só absoluta | ambas | Revisão | Crescimento | Base pequena |
|---|---|---|---|---|---|---|---|---|
| 7 dias | Shopee | 23 | 13 | **2 (91 un)** | 8 | 26 | 5 | 0 |
| 7 dias | ML Antigo | 8 | 7 | 0 | 1 | 14 | 1 | 0 |
| 7 dias | ML Novo | 2 | 2 | 0 | 0 | 2 | 1 | 0 |
| 30 dias | Shopee | 7 | 5 | 0 | 2 | 9 | 18 | 7 |
| 30 dias | ML Antigo | 5 | 5 | 0 | 0 | 10 | 10 | 3 |
| 30 dias | ML Novo | 5 | 5 | 0 | 0 | 4 | 2 | 0 |

O limiar absoluto muda pouco: só a Shopee em 7 dias (2 anúncios). Nos 30 dias não acrescenta nenhum.

### Cobertura real nessas janelas (GA-018, leitura)
O dia 24/11 é **parcial** nas três contas: o período atual (7 e 30 dias) fica PARCIAL e **não é comprovado**; o anterior de 7 dias é COMPLETO e o de 30 dias é PARCIAL (5 dias com registros não verificados). Resultado hoje: nenhuma classificação confirmada; tudo em "Dados insuficientes" até o último dia fechar. Como o último dia importado costuma estar parcial, isso se repete: **decisão do Atlas** se o fim do período deve ser o último dia completo.

### Desempenho medido (view real, leitura)
Shopee 30 dias: 310 anúncios, 56 KB, 0,25 s, conciliada com o Dashboard (6236 e 4897 un). Relatórios reais da Shopee: recente 7 dias, anterior 30 dias, intervalo de 11 dias.
