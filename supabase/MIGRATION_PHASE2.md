# NISTI ID — Migração D1 → Supabase (Fase 2)

## Objetivo

Copiar os dados relacionais atuais do Cloudflare D1 para o projeto Supabase `nisti-identificacao`, preservando IDs e sem alterar o tráfego de produção durante a cópia.

Arquitetura alvo:

```text
Cloudflare Worker
├── Supabase PostgreSQL → dados relacionais autoritativos
├── Vectorize           → retrieval visual
├── R2                  → imagens
└── Gemini              → embeddings/IA
```

## Regras de segurança

- Não desligar D1 durante a exportação.
- Não alterar thresholds `0.920 / 0.008`.
- Não reindexar Vectorize nesta fase.
- Não mover imagens do R2.
- Não executar cutover antes da validação de paridade.
- Não versionar snapshots/exportações; `migration-export/` é ignorado pelo Git.
- Wrangler deve permanecer exatamente em `3.114.17` durante esta operação.

## 1. Snapshot do D1

Executar somente quando a quota diária do D1 estiver disponível:

```powershell
cd C:\Users\User\nisti-identificacao
git fetch origin main
git switch main
git pull --ff-only

powershell -ExecutionPolicy Bypass -File .\scripts\export-d1-for-supabase.ps1
```

O script cria:

```text
migration-export/<UTC>/
├── d1-data.sql
├── d1-schema.sql
├── d1-counts.json
└── manifest.json
```

`manifest.json` contém SHA-256 dos dois exports SQL. Preserve o diretório sem edição até a conclusão da migração.

## 2. Importação

A importação deve preservar os IDs do D1. A ordem de dependências é:

1. `products`
2. `product_platforms`
3. `cover_embeddings`
4. `recognition_daily`
5. `recognition_events`
6. `cover_visual_references`
7. `cover_reference_embeddings`
8. `cover_visual_signatures`
9. `notifications`
10. `notification_reads`
11. `push_subscriptions`
12. `scan_occurrences`
13. `geometric_shadow_evidence`

Não importar tabelas internas do Wrangler/D1.

## 3. Sincronização de IDENTITY

Depois da importação, executar `supabase/sql/after_d1_import.sql` para posicionar as sequences PostgreSQL após os maiores IDs importados.

## 4. Validação de paridade

Executar `supabase/sql/validate_d1_import.sql`.

Critérios obrigatórios antes do cutover:

- contagem de cada tabela igual ao snapshot `d1-counts.json`;
- zero violações referenciais;
- zero violações dos invariantes de negócio;
- plataformas somente `MERCADO LIVRE`, `SHOPEE` e `AMAZON`;
- IDs preservados;
- nenhuma tabela de produção apontando para Supabase ainda.

## 5. Cutover

O cutover será uma fase separada. Primeiro serão migrados os reads críticos de operação e validada a equivalência D1/Supabase. D1 permanecerá disponível como rollback até a validação em produção.
