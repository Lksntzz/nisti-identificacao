# GA-P02D — Roteiro de conciliação da `commerce_data_quality_coverage_v1` com dados reais

**Status:** preparado; NADA executado em produção. Só roda depois de o Atlas aprovar a aplicação da migração `20261127140000_commerce_data_quality_coverage_v1.sql`. O Worker NÃO troca para a função leve nesta etapa; a GA-011 e `commerce_data_quality_v1` não são alteradas.

## Portão antes de pedir a aplicação
1. Confirmação do novo backup externo (último verificado: 25/11/2026 20:18 UTC; ver `docs/cerebro/backup.md`).
2. `npm test` e `npm run test:db` verdes; checks build, database e Chromium verdes na PR.
3. Aprovação explícita do Atlas para aplicar (e, separadamente, para trocar o Worker).

## Regras (só leitura)
- Uma consulta por vez, ≥30 s entre elas, fora de importações; `set local statement_timeout='5s'` definido e confirmado (`show`) na mesma transação; sem aumentar limites.
- Cancelada = **INCONCLUSIVO**, que **não é equivalente** e não é coberto por soma de vendas: repetir por fatias (abaixo) até virar IDÊNTICO.
- Não gravar dados comerciais no repositório: registrar só IDÊNTICO/DIVERGE/INCONCLUSIVO e hashes.

## Parte A — janelas em que a função completa responde em ≤5 s
Para cada conta (SHOPEE, ML_ANTIGO, ML_NOVO) e janela 7, 30 e 60 dias (atual e anterior):
```sql
begin; set local statement_timeout='5s'; show statement_timeout;
select (f.r->'platform')=(l.r->'platform') and (f.r->'period')=(l.r->'period')
   and (select bool_and((f.r->'sales'->k)=(l.r->'sales'->k)) from unnest(array['requested_days','complete_days','partial_days','days_with_records_unverified','days_without_information','missing_ranges','status','note']) k) as identico
from (select public.commerce_data_quality_v1('<CONTA>','<INI>','<FIM>',false) r) f,
     (select public.commerce_data_quality_coverage_v1('<CONTA>','<INI>','<FIM>') r) l;
rollback;
```
Registrar também a versão dos dados (`commerce_data_version_v1()`) antes e depois: se mudar, descartar o par e repetir.

## Parte B — janelas longas (histórica e anual das categorias), onde a completa estoura
Verificação independente por **fatias**: partir a janela em fatias de ≤60 dias, chamar a função **completa** em cada fatia (cada uma ≤5 s) e somar: `requested_days`, `complete_days`, `partial_days`, `days_with_records_unverified`, `days_without_information` são aditivos; `missing_ranges` das fatias, com intervalos vizinhos unidos nas fronteiras, deve igualar o da função leve na janela inteira; `status` é derivado (SEM_INFORMACAO se todos os dias sem informação; PARCIAL se houver sem informação/parcial/com registros; senão COMPLETA). Comparar com a leve chamada uma vez na janela inteira (também com `statement_timeout` de 5 s; se ela estourar, INCONCLUSIVO — e vira achado para o Atlas, não motivo de aumentar limite).
Janelas: histórica (primeiro dia com dados → último) de cada conta; ano até hoje e mesmo período do ano anterior (categorias); 90 dias atual e anterior.

## Parte C — critérios de cobertura no Worker (sem trocar o Worker)
Com as saídas da leve e da completa de cada caso, aplicar `coverageProven` (e, na PR #940, `coverageUnprovenCause`) às duas: o resultado tem que ser o mesmo.

## Aprovação
Todas as combinações IDÊNTICAS (A e B) e nenhuma INCONCLUSIVA pendente. Qualquer DIVERGE interrompe e volta ao Atlas.

## Reversão
`supabase/rollback/20261127140000_commerce_data_quality_coverage_v1.down.sql` (drop da função leve). Como o Worker não a usa, a reversão não afeta nenhuma tela.
