# Remoção do ambiente preview do Catálogo Comercial (GA)

Data: 27/10/2026 · Status: **desenho aprovado pelo usuário; esta spec aguarda revisão** · Parte B da organização do repositório.

## 1. Objetivo

Remover por completo o "ambiente preview" (um sandbox paralelo do Catálogo Comercial que não é mais usado), em duas fases independentes e reversíveis:

- **Fase 1:** código, workflows e testes. O banco não é tocado.
- **Fase 2:** objetos do banco (72 funções e 20 tabelas `commerce_preview_*`).

Critério de sucesso: nada muda para quem usa o GA em produção; o repositório e o banco deixam de carregar uma cópia congelada e divergente da lógica real; nenhuma configuração antiga de preview consegue gravar nos dados reais.

## 2. Estado atual (medido em 27/10/2026)

| Fato | Evidência |
|---|---|
| A migração `commerce_drop_unused_functions_v1` já foi aplicada em produção (última da lista); as 20 funções sem uso e as 3 de "Evolução de vendas" já não existem. | `list_migrations` do projeto Supabase |
| Existem 72 funções `commerce_preview_*` e 175 funções reais `commerce_*`. 61 das 72 têm par real; 11 não têm. | consulta ao catálogo do banco |
| Existem 20 tabelas `commerce_preview_*`, ~0,8 MB no total. Só `commerce_preview_marketplaces` (9 linhas) e `commerce_preview_categories` (8 linhas) têm dados, ambas cópias do cadastro real. | contagem exata por tabela |
| Nenhuma tabela real tem chave estrangeira para tabela preview; nenhum gatilho usa função preview. | consultas ao catálogo |
| Nenhuma das 130 migrações posteriores a 28/09/2026 cria objeto preview. | `git grep` por período |
| `commerce-preview.yml` só dispara para duas branches antigas; as execuções recentes estão todas "skipped". `wrangler.preview.toml` ainda aponta para o D1 legado. | histórico de execuções |
| `commerce_management_resolve_link_v1` (real) **não existe** no banco; só a cópia `commerce_preview_management_resolve_link_v1`. A rota que a usa responde 409 em produção e nenhuma tela a chama. | banco + `grep` em `src/` |
| Produção roda com `APP_ENV=production` e `COMMERCE_DATA_SCOPE=live`. | `wrangler.toml` |

## 3. Decisões do usuário

1. Executar as duas fases, na ordem, cada uma em seu pull request.
2. **Remover** a rota `POST /api/admin/commerce/management/link-review/:id/resolve` e a função `commerceResolveManagementLink` (funcionalidade que nunca saiu do sandbox).
3. Cada publicação só ocorre quando o usuário disser "publica" no respectivo pull request.

## 4. Fase 1 — código (banco intocado)

Branch: `chore/remove-ambiente-preview-codigo`.

### 4.1 Comportamento novo, regra de segurança (fail-closed)

Hoje, `APP_ENV=preview` + `COMMERCE_DATA_SCOPE=preview` desvia toda chamada `commerce_x` para `commerce_preview_x`. Se o desvio simplesmente sumisse, um servidor com a configuração antiga passaria a usar os **dados reais**. Regra nova:

- `commerceDataScope(env)` (em `src/commerce-rpc.js`): escopo vazio ou `live` → retorna `'live'`; `preview` → **lança erro** ("O ambiente preview do Catálogo Comercial foi removido."); qualquer outro valor → lança erro, como hoje. `APP_ENV=preview` também lança o mesmo erro, qualquer que seja o escopo.
- `commerceRpcName(env, nome)`: continua exigindo o prefixo `commerce_`, chama `commerceDataScope` (para o guard valer) e devolve o nome **sem alteração**.
- `src/nisti-commerce-sync.js`: as funções `syncNistiProductsToCommerce`, `reconcileNistiProductToCommerceSafe`, `nistiCommerceSyncStatus` e `nistiCommerceProductStatuses` chamam `supabaseRpc` diretamente com nomes reais. O helper `isPreview` e seus 4 desvios saem; no lugar, a **primeira linha** de cada uma dessas funções chama `commerceDataScope(env)`, de modo que, com configuração preview, lançam erro e **nenhuma** chamada ao banco é feita. O caminho de produção fica byte a byte equivalente.
- O campo `preview` da resposta de `GET /api/admin/commerce-sync/nisti-products` é removido: nenhuma tela o lê (as telas usam apenas `.../statuses` e `.../repair`).

### 4.2 Arquivos alterados

| Arquivo | Mudança |
|---|---|
| `src/commerce-rpc.js` | regra 4.1 |
| `src/commerce-admin-router.js` | remove `commercePreviewSandbox` e a rota `link-review/:id/resolve` (e o `import` de `commerceResolveManagementLink`, se ficar sem uso) |
| `src/commerce-supabase-store.js` | remove `commerceResolveManagementLink` |
| `src/nisti-commerce-sync.js` | regra 4.1 |
| `.github/workflows/commerce-preview.yml` | apagado |
| `wrangler.preview.toml` | apagado |
| `test/commerce-preview.test.js` | apagado |
| `test/commerce-rpc-scope.test.js` | reescrito para o comportamento novo (ver 4.3) |
| `test/commerce-cross-platform-image-fallback.test.js`, `commerce-listing-editor.test.js`, `commerce-new-product-suggestions.test.js`, `commerce-nisti-id-media-fallback.test.js`, `commerce-probable-bulk.test.js`, `commerce-product-platform-cards.test.js`, `commerce-product-state.test.js`, `commerce-product-thumbnail-year-safety.test.js`, `commerce-shopee-snapshot.test.js`, `nisti-commerce-sync.test.js` | ajustadas **somente** as linhas que tratam de preview; nenhum teste de comportamento real é apagado |
| `docs/MAPA-GA.md` | corrige as seções 1 (números), 3 (observação sobre Evolução de vendas), 5 (linha "Preview (legado)"), 6 (famílias de funções) e 7 (candidatos a limpeza): as 23 funções já foram removidas em produção e o preview foi removido do código |

Não mudam: migrações antigas (são histórico), variáveis de produção, `docs/mural-pdp-compliance.md` (a palavra "preview" ali é outro assunto).

### 4.3 Testes novos ou reescritos

1. Escopo vazio e `live`: `commerceRpcName` devolve o nome inalterado.
2. `COMMERCE_DATA_SCOPE=preview` lança erro; `APP_ENV=preview` lança erro.
3. As 4 funções de `nisti-commerce-sync.js`, com escopo preview, lançam erro **e não chamam `supabaseRpc`**.
4. Guarda estática: nenhum arquivo de `src/` contém a cadeia `commerce_preview_`.

### 4.4 Verificação e critérios de aceite

- `npm test` completo, 0 falhas (linha de base atual: 1.183 testes, 1.181 ok, 2 ignorados).
- `git grep -n "commerce_preview_" -- src` não retorna nada.
- `git grep -n -i "preview" -- .github wrangler*.toml` não retorna nada relativo ao Catálogo Comercial.
- Pull request com o CI (Production Gate) verde.

### 4.5 Publicação e teste manual

Ao dizer "publica", faço o merge e o deploy. Em seguida entrego um roteiro passo a passo para o usuário conferir no GA: Dashboard, Painel Comercial (abrir lista e um filtro), Planejamento de Produtos, Histórico de importações e a lista de produtos do NISTI ID com os selos de plataforma. A Fase 2 só começa depois da confirmação do usuário de que tudo abre normalmente.

## 5. Fase 2 — banco

Branch: `chore/remove-ambiente-preview-banco`, criada a partir da `main` já com a Fase 1 publicada.

### 5.1 Inventário prévio (somente leitura; sem ele a migração não é escrita)

Listar, no projeto Supabase de produção:

1. Funções, tabelas, views, tipos, sequências, políticas (RLS), gatilhos e índices cujo nome contenha `commerce_preview`.
2. Qualquer outra função cujo código cite a cadeia `commerce_preview_` (a busca anterior pela palavra "preview" apontou `nisti_reserve_mural_feed_v1`; confirmar que é outro sentido da palavra).
3. Comandos das tarefas agendadas (`cron.job`; hoje: `nisti_backup_semanal` e `nisti_audit_limpeza`).
4. Edge Functions do Supabase que citem `commerce_preview`.
5. Dependências de objetos (`pg_depend`) de fora do conjunto preview sobre objetos do conjunto.

**Condição de parada:** qualquer dependência encontrada fora do conjunto preview interrompe a Fase 2; relato ao usuário antes de prosseguir.

### 5.2 Migração

Arquivo `supabase/migrations/<carimbo>_commerce_drop_preview_sandbox_v1.sql`, onde `<carimbo>` é a data e hora da criação no mesmo formato das demais migrações (14 dígitos). Segue o molde da `commerce_drop_unused_functions_v1`:

- Fase de checagem: aborta sem alterar nada se (a) alguma função fora do conjunto citar `commerce_preview_`, (b) existir gatilho cruzando o conjunto, (c) existir chave estrangeira de tabela real para tabela preview, (d) o conjunto de funções ou tabelas encontrado diferir da lista explícita da migração.
- Fase de remoção: as 72 funções por nome explícito, depois as 20 tabelas, **sem CASCADE**.
- Cabeçalho com o motivo, a data e o arquivo de recuperação (5.3).

### 5.3 Segurança e recuperação

- Antes de aplicar: `select backup.take_snapshot_v1(4)` (cópia das 12 tabelas críticas reais) e registro do resultado no pull request.
- Antes de apagar: exportar as definições atuais (`pg_get_functiondef` das 72 funções, DDL das 20 tabelas e as 17 linhas das duas tabelas com dados) para `docs/arquivo/preview-sandbox-recuperacao.sql`, com cabeçalho explicando que é arquivo de recuperação e pode ser removido depois de 30 dias de produção estável. Recuperar = executar esse único arquivo.
- Aplicação em produção somente quando o usuário disser "publica" neste pull request, depois de eu mostrar a lista final do que será apagado.

### 5.4 Verificação e critérios de aceite

- Após aplicar: 0 funções e 0 tabelas `commerce_preview_*`; funções reais `commerce_*` continuam 175; tamanho do banco medido antes e depois.
- Consulta de segurança do Supabase (advisors) sem novos alertas.
- `npm test` verde; `MAPA-GA.md` atualizado (seções 1, 5, 6 e 7: números finais de funções e tabelas, medidos no banco depois da remoção).
- O usuário repete o roteiro manual do item 4.5.

## 6. Fora do escopo

Funções e tabelas reais do GA, migrações legadas do D1 e o comando `db:migrate` (parte C), CSS e arquivos gigantes (parte D), a rota `GET .../link-review/:id` e `commerce_management_link_candidates_v2` (permanecem), variáveis e segredos de produção, backup externo criptografado.

## 7. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Servidor com configuração preview antiga gravando em dados reais | regra fail-closed (4.1) com testes (4.3) |
| Quebrar o caminho de produção ao remover desvios | `nisti-commerce-sync.js` mantém o caminho real idêntico; suíte completa; roteiro manual |
| Objeto escondido dependendo do sandbox (Edge Function, tarefa agendada) | inventário 5.1 com condição de parada |
| Apagar algo que depois se queira de volta | arquivo de recuperação (5.3), snapshot e fases em pull requests separados |
| Deploy da Fase 1 dispara produção | o bloqueio do repositório só publica a partir de pull request com CI verde |

## 8. Portões de aprovação

1. Revisão desta spec pelo usuário → 2. plano de execução escrito e revisado → 3. Fase 1 implementada, pull request aberto → 4. "publica" (Fase 1) → 5. confirmação do roteiro manual → 6. Fase 2 (inventário, pull request, lista final) → 7. "publica" (Fase 2).
