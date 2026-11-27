# GA-P02C — Roteiro de conciliação da `commerce_categories_v3` com dados reais

**Status:** preparado; NADA executado em produção. Só roda depois de o Atlas aprovar a aplicação da migração `20261126210000_commerce_categories_v3.sql`.

## Antes de pedir a aplicação (portão)
1. **Backup externo atualizado.** O último verificado é de **25/11/2026 20:18 UTC** (226 tabelas, restauração PASS; o de 24/11/2026 19:27 UTC é anterior; ver `docs/cerebro/backup.md`). Mesmo assim, aguardar a confirmação do novo backup antes de pedir aplicação. A migração só cria uma função (não altera dados), mas o Atlas exigiu backup externo atualizado: o Lucas gera um novo no computador dele e registra data/SHA-256 aqui. Sem isso, não pedir aplicação.
2. `npm test` e `npm run test:db` verdes na PR da migração; checks build, database e Chromium verdes.
3. Aprovação explícita do Atlas para aplicar (e, separadamente, para trocar o Worker).

## Regras da conciliação (só leitura)
- Uma consulta por vez, ≥30 s entre elas, fora de importações, `statement_timeout` de 5 s definido e confirmado na mesma transação (`set local`); sem aumentar limites.
- Cancelada = **inconclusiva** (registrar; não repetir com limite maior). A v2 já estoura em Shopee 30/60/90 d quando fria.
- **Comparação conjunta acima de 5 s:** passar para a **comparação individual** (v2 e v3 em transações separadas, uma por vez), garantindo MESMA versão dos dados e MESMOS períodos: antes e depois de cada chamada registrar `commerce_data_version_v1()` e as datas de referência do resultado (`as_of`, janelas atual/base); se a versão ou as datas diferirem entre as duas chamadas, descartar o par e repetir. Os jsonb obtidos são comparados fora do banco (hash do total, de cada categoria e de cada coleção, ver abaixo).
- **Totais iguais NÃO provam equivalência.** Só vale IDENTICO quando o jsonb inteiro bate (md5 do texto) **e**, em separado, cada categoria (`categories[].name`) e cada coleção (`categories[].cols[].name`) têm os mesmos valores (cur, base, cur_rev, base_rev, c28, b28) e a mesma ordem. Soma direta da view serve apenas como checagem adicional de totais, nunca como substituta.
- Ordem: 7 d → 30 d → 60 d → 90 d; Shopee por último em cada janela. Parar ao primeiro sinal de sobrecarga.
- Não gravar dados comerciais no repositório: registrar só OK/DIVERGE/INCONCLUSIVO e hashes.

## Modelo de cada caso (substituir `ARGS`)
```sql
begin; set local statement_timeout='5s'; show statement_timeout;
select md5(public.commerce_categories_v2(ARGS)::text) = md5(public.commerce_categories_v3(ARGS)::text) as identico;
rollback;
```
Em caso de DIVERGE, comparar `jsonb` por chave (total, categorias, coleções) e parar.

## Casos
| # | Conta | Modo | ARGS |
|---|---|---|---|
| 1–4 | SHOPEE | 7/30/60/90 dias | `'SHOPEE',null,'days',null,N` |
| 5–8 | ML_ANTIGO | 7/30/60/90 dias | `'ML_ANTIGO',null,'days',null,N` |
| 9–12 | ML_NOVO | 7/30/60/90 dias | `'ML_NOVO',null,'days',null,N` |
| 13–15 | cada conta | mensal (mês fechado mais recente) | `'<CONTA>',2026,'month',<M>,null` |
| 16–18 | cada conta | anual (ano até hoje) | `'<CONTA>',2026,'ytd',null,null` |
| 19–21 | cada conta | anual anterior | `'<CONTA>',2025,'ytd',null,null` |
| 22–24 | TODAS | 30 dias, mensal, anual | `'TODAS',null,'days',null,30` / `'TODAS',2026,'month',<M>,null` / `'TODAS',2026,'ytd',null,null` |

Total: **24 combinações** (12 contas × períodos em dias + 3 mensais + 3 anuais + 3 ano anterior + 3 de TODAS).

Critério de aprovação: **as 24 combinações IDÊNTICO** (jsonb inteiro e cada categoria/coleção), sem DIVERGE. Resultado INCONCLUSIVO (consulta cancelada, versão/datas diferentes) **não é equivalente** e **não é coberto pela soma direta das vendas**: precisa ser repetido até virar IDÊNTICO (comparação individual, mesma versão e mesmos períodos). Enquanto restar qualquer caso inconclusivo, a conciliação NÃO está aprovada.

## Após aprovada a troca do Worker (passo futuro, separado)
- Incluir `commerce_categories_v3` na lista permitida de `commerce_cached_read_v1` (migração própria; a chave de cache já é `função|argumentos`, então v2 e v3 não se misturam) e trocar a chamada em `commerce-supabase-store.js` (único consumidor de `commerce_categories_v2`).
- Reversão: voltar a chamada para a v2 (deploy) e, se preciso, `supabase/rollback/20261126210000_commerce_categories_v3.down.sql`.
