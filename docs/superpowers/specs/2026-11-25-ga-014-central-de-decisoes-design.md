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
