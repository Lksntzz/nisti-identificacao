# NISTI — Auditoria de D1 legado, índices e migrações

Data: 21/10/2026. Escopo: inspeção de código no GitHub e consultas SOMENTE DE LEITURA ao Supabase de produção.
Status: diagnóstico, sem alteração do banco, sem execução de migrations e sem exclusão de dados.

## 1. Autoridade de dados e fluxos atuais

- wrangler.toml: Worker principal src/operator-audit-router.js, SUPABASE_READS_ENABLED=1, SUPABASE_WRITE_MODE=primary e armazenamento de imagens no bucket R2 PRODUCT_IMAGES. Não declara binding [[d1_databases]].
- wrangler.d1-compat.toml: Worker de compatibilidade com binding DB e migrations_dir=migrations. É uma configuração separada da principal.
- src/supabase-read-store.js: preferSupabaseRead executa o leitor Supabase quando SUPABASE_READS_ENABLED=1; o leitor D1 só é escolhido quando a configuração desativa explicitamente esse modo. Falha de Supabase não deve cair silenciosamente no D1.
- src/supabase-write-store.js: mantém funções antigas mirrorProductCatalogBatchFromD1 e leituras explícitas env.DB.prepare. A seleção do modo primary não elimina fisicamente essas rotinas.
- src/supabase-secondary-write-store.js: retém espelhamento de notificações, imagens, Mural e inscrições de push a partir de env.DB.
- src/supabase-mutation-mirror.js: o processamento pós-mutação ignora várias rotas que já gravam diretamente no Supabase primário, mas mantém ramificações históricas de sincronização D1. Não remover antes de fazer inventário de chamadas/rotas e testes de regressão.

Conclusão comprovada no repositório: a configuração principal publica Supabase como autoridade e não prevê D1 operacional. Limite da evidência: não foi inspecionada a configuração atualmente implantada na conta Cloudflare; não afirmar inexistência absoluta de dependências em execução.

## 2. Dependências D1 que permanecem no projeto

| Local | Uso observado | Risco / providência |
| --- | --- | --- |
| .github/workflows/production-gate.yml | Valida migrations D1 localmente | Tempo de CI e manutenção de esquema legado; conservar até validar retirada |
| .github/workflows/deploy-production.yml | Valida D1 localmente e aplica migration remota D1 quando migrations/*.sql muda | Uma alteração incidental em migrations/ pode acionar escrita no D1 remoto; não misturar com migrações Supabase |
| package.json | db:migrate chama wrangler d1 migrations apply --remote com configuração de compatibilidade | Comando é exclusivo do D1 antigo; não usar para atualizar PostgreSQL |
| .github/workflows/export-original-product-images.yml | Índice de produtos vem do D1 remoto, arquivos são baixados do R2 | Exportação pode ignorar imagens de produtos atuais do Supabase; não utilizar como backup completo |
| .github/workflows/supabase-final-snapshot.yml | Apesar do nome, faz export de esquema/dados do D1 remoto | Não é backup do Supabase. Possui guardas de corte antigo que não correspondem às flags atuais |
| scripts/export-original-product-images.mjs | Usa o índice repassado pelo workflow acima | Revisar origem dos identificadores antes de migrar exportação |
| wrangler.d1-compat.toml e migrations/ | Estado e alterações do banco legado | Preservar histórico; não apagar sem backup/restauração comprovados |
| src/supabase-*-store.js e src/supabase-mutation-mirror.js | Fallback/mirror de compatibilidade | Verificar chamadas restantes antes de remoção |

Os guias docs/BACKUP-GRATUITO-NISTI.md e docs/PLANO-PROTECAO-E-RECUPERACAO.md já reconhecem que o exportador D1 não produz backup atualizado do Supabase/R2. A documentação deve impedir explicitamente que operadores confundam esses fluxos.

## 3. Auditoria dos índices ausentes

Advisory do Supabase (performance): 5 unindexed_foreign_keys em public, sem conclusão automática de degradação.
Contagens por consulta COUNT(*) ao vivo: manual_listing_sales=0; marketplace_snapshots=0; shopee_finance_daily_v1=13.647; shopee_finance_month_v1=10. Na tabela diária, 13.647 registros têm month_start e source_snapshot_id preenchidos, distribuídos por 10 meses e 10 snapshots distintos.

| Prioridade | Tabela / chave estrangeira | Linhas | Situação e decisão |
| --- | --- | ---: | --- |
| Alta para avaliação | commerce_shopee_finance_daily_v1 (month_start) | 13.647 | Referência à tabela mensal com ON DELETE CASCADE; planejar índice e comparar operações antes/depois |
| Alta para avaliação | commerce_shopee_finance_daily_v1 (source_snapshot_id) | 13.647 | Referência ao snapshot de origem; candidato a índice depois de validar uso |
| Baixa | commerce_shopee_finance_month_v1 (source_snapshot_id) | 10 | Índice ausente, mas tabela pequena; avaliar crescimento projetado |
| Baixa | commerce_manual_listing_sales (nisti_product_id) | 0 | A PK começa por listing_id e o índice de período começa por period_month; não cobrem o filtro direto por nisti_product_id |
| Baixa | commerce_marketplace_snapshots (marketplace_id, account_code) | 0 | Índices existentes não começam pelo par completo; tabela vazia no momento |

EXPLAIN (sem ANALYZE e sem executar a consulta) de contagem filtrada por month_start e por source_snapshot_id no financeiro diário indicou Seq Scan nos planos atuais. Isso é uma fotografia do planejador, não uma medição de ganho que prove necessidade de índice; pode variar conforme distribuição, estatísticas e consultas reais.

### SQL proposto SOMENTE PARA REVISÃO — NÃO EXECUTADO

Cada comando deve ser planejado e aplicado separadamente, fora de transação explícita, se for escolhida a construção CONCURRENTLY. IF NOT EXISTS verifica nome, não garante definição adequada de índice preexistente. Conferir pg_indexes antes de executar.

~~~sql
-- Prioridade: verificar estes dois em janela controlada
CREATE INDEX CONCURRENTLY IF NOT EXISTS commerce_shopee_finance_daily_month_fk_idx
  ON public.commerce_shopee_finance_daily_v1 (month_start);

CREATE INDEX CONCURRENTLY IF NOT EXISTS commerce_shopee_finance_daily_snapshot_fk_idx
  ON public.commerce_shopee_finance_daily_v1 (source_snapshot_id);

-- Outros três: apenas quando volume/consultas justificarem
CREATE INDEX CONCURRENTLY IF NOT EXISTS commerce_shopee_finance_month_snapshot_fk_idx
  ON public.commerce_shopee_finance_month_v1 (source_snapshot_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS commerce_manual_listing_sales_product_fk_idx
  ON public.commerce_manual_listing_sales (nisti_product_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS commerce_marketplace_snapshots_account_fk_idx
  ON public.commerce_marketplace_snapshots (marketplace_id, account_code);
~~~

Não aplicar esta proposta por executores que encapsulam a operação em transação. Antes de criar índices em produção: confirmar backup restaurável; verificar custo e consultas reais; planejar janela; medir duração/custo e locks; conferir índices válidos, pg_stat_user_indexes e advisories após aplicação. Se o ambiente exigir migração SQL transacional, validar alternativa sem CONCURRENTLY em janela de manutenção ou um procedimento externo documentado. Índices aumentam escritas e ocupação.

## 4. Inventário de migrações Supabase

A consulta live list_migrations retornou 235 registros de migração, da versão 20260904204902 (nisti_core_schema_v8244) à 20261021131640 (nisti_dispatch_monitor_recent_v8). A base de migrações Supabase e a pasta D1 migrations/ são sistemas distintos e não podem ser confundidos.

Marcos do histórico registrado:
- 04 a 16/set: esquema NISTI, identificação de operadores, GTIN e espelhamento inicial;
- 22 a 29/set: catálogo comercial, importações Shopee/marketplaces, reconciliação, vendas e Mural inicial;
- 01/out: leitura e escrita primárias Supabase, reserva de registros, imagens, GTIN, notificações, Mural, tratamento e dependências;
- 02/out: índices pós-cutover, proteção de funções e retirada de integrações antigas de IA;
- 14 a 16/out: mudanças de identidade dos anúncios, variações, histórico comercial e controle de acesso;
- 19 a 21/out: anúncios, Shopee Ads, pós-venda e painel de notificação da expedição.

Dois nomes foram reutilizados com versões diferentes no histórico: primary_operational_residual_writes_v1 e requeue_product_treatment_contour_v9. A versão temporal diferencia as migrações; evitar novas reutilizações de nome.

Não foi feita reconciliação arquivo a arquivo das 235 versões com todas as pastas GitHub. Essa comparação é uma tarefa pendente, e não se deve declarar inexistência de drift sem efetuá-la. Não editar migrações já aplicadas; aplicar aditivas com rollback documentado.

## 5. Sequência segura de mudanças futuras

1. Confirmar cópia restaurável do Supabase e cópia íntegra do R2. Nenhuma foi comprovada nesta auditoria.
2. Separar formalmente o caminho de migrações D1 de compatibilidade e o Supabase primário no CI e na documentação. Evitar que uma alteração PostgreSQL acione atualização D1.
3. Substituir a origem D1 do índice de exportação R2 por leitura do catálogo atual no Supabase; testar amostra e comparar contagem de imagens antes de aposentar o fluxo antigo.
4. Executar primeiro testes/avaliação dos dois índices candidatos da tabela Shopee financeira diária, com aprovação e medição de planos/consultas.
5. Reexecutar Supabase Performance Advisor. Reavaliar índices de tabelas vazias somente quando os dados crescerem e justificarem.
6. Levantar todos os pontos de env.DB e preferSupabaseRead nos módulos de execução; eliminar cada ramo morto em PR separado com testes e rollback.

## 6. Fontes e verificações

- Código: wrangler.toml; wrangler.d1-compat.toml; package.json; src/supabase-read-store.js; src/supabase-write-store.js; src/supabase-secondary-write-store.js; src/supabase-mutation-mirror.js.
- Automação: .github/workflows/production-gate.yml; .github/workflows/deploy-production.yml; .github/workflows/export-original-product-images.yml; .github/workflows/supabase-final-snapshot.yml.
- Banco: Supabase Performance Advisor, pg_constraint, pg_index, pg_stat_user_tables, COUNT(*), EXPLAIN (FORMAT JSON), list_migrations, todas consultas sem DDL.
- Referências: https://supabase.com/docs/guides/observability/advisors ; https://supabase.com/docs/guides/database/postgres/indexes ; https://www.postgresql.org/docs/current/sql-createindex.html ; https://developers.cloudflare.com/workers/wrangler/configuration/

STATUS FINAL: investigação/documentação. Sem migration aplicada, índice criado, exclusão executada ou alteração de produção.
