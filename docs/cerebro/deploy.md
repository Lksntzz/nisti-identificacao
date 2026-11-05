# Publicar mudanças (deploy)

Regra do projeto: **nunca commit direto na `main`**. Tudo passa por PR.
Hospedagem: Cloudflare Worker (entrada `src/operator-audit-router.js`, depois `src/edge-router.js`). Banco: Supabase. Só planos gratuitos.

## Fluxo, sempre assim

1. Branch nova a partir da `main` atualizada.
2. `npm test` precisa passar antes de abrir o PR.
3. Abrir o PR.
4. Esperar **todos** os checks ficarem verdes, sem nenhum em andamento. Check "skipped" não conta como terminado. Checks principais: Production Gate, Browser Smoke.
5. Mesclar com squash.
6. Esperar o workflow **Deploy Production** do commit mesclado terminar com sucesso. Cuidado: pode aparecer o deploy de um commit anterior; conferir que é o do commit certo.
7. Mudou tela, tabela, função SQL, rota ou regra de importação do GA? Atualizar o [[MAPA-GA]] no mesmo PR.

## Migração SQL (o deploy NÃO aplica sozinho)

- Salvar em `supabase/migrations/` com data e hora no nome (ex.: `20261103160000_nome.sql`).
- **Aplicar manualmente** no Supabase e conferir depois.
- Esquecer de aplicar já aconteceu: o código foi ao ar e a importação teria falhado.
- Testar escrita com bloco `DO` terminado em `raise exception 'TESTE_OK'` (desfaz tudo).

## Armadilhas já vividas

- Mesclar PR antes de todos os checks terminarem causou falha no Deploy Production.
- Várias sessões de IA em paralelo reconstruíram a `main` e geraram conflito em PR aberto por muito tempo: PRs pequenos e mesclados logo.
- O check "Workers Builds: nisti-identificacao" aparece como falha em branches e na `main` mesmo com o deploy do GitHub Actions funcionando. Tratado como ruído antigo, não como bloqueio.
- Apagar branch remota pode retornar 403; deixar a branch e avisar o Lucas.

## Regras gerais

- O repositório é público: nenhum dado de negócio, senha ou chave em arquivo.
- Nunca digitar nem pedir senhas; trocar senha de administrador é com o Lucas.
- Na dúvida sobre o pedido, perguntar antes de implementar.
