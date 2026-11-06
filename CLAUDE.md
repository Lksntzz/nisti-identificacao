# Instruções para quem trabalha neste repositório (IA ou pessoa)

Dono: Lucas, leigo em programação. Fala português. O sistema é o NISTI ID e o GA (Gestor de Anúncios, `GA`, host `ga.sistemanistiid.online`).

## Como conversar
- Tom de conselheiro crítico: apontar riscos, gargalos e contrapontos. Não validar ideia automaticamente.
- Tarefa manual para o Lucas: passo a passo detalhado (onde clicar, o que colar, o que esperar).
- Na dúvida sobre o pedido, perguntar antes de implementar.
- Só planos GRATUITOS (Cloudflare, Supabase, GitHub). Nada que gere custo.

## Tecnologia
- JavaScript (sem TypeScript). Interface React 18 + Vite 8. Servidor: Cloudflare Worker (`src/operator-audit-router.js` é a entrada, depois `src/edge-router.js`). Banco: Supabase Postgres, projeto `yioetdcbgorunwgwuawg` (sa-east-1). Imagens: R2.
- O navegador nunca fala com o banco. Caminho: tela → `/api/admin/commerce/...` → router → `src/ga/commerce-supabase-store.js` → função SQL `commerce_*_vN`.
- Mapa completo do GA: `docs/MAPA-GA.md`. Se divergir do código, vale o código e o mapa deve ser atualizado.
- Testes: `npm test` (todos devem passar antes de abrir PR).
- Notas curtas por assunto: comece por `docs/cerebro/INDEX.md` e leia só a nota da área em que for mexer (GA, deploy, limites de requisição). Mudou o código de uma área? Atualize a nota dela no mesmo PR.
- A nota é ponto de partida, não prova. Se a mudança grava, apaga ou migra dados (gatilhos, funções SQL, importação), confira o código ou o SQL ATUAL antes de agir; as migrações mais novas podem ter redefinido a função.
- Trabalhando numa cópia local (Obsidian, Claude Code no PC)? Rode `git pull` antes de começar; nota velha é repetida como se fosse verdade.

## Publicar (sempre assim)
1. Branch nova a partir da `main`. Nunca commit direto na `main`.
2. Abrir PR. Esperar TODOS os checks ficarem verdes (não parar no check "skipped"; esperar sem nenhum em andamento).
3. Mesclar com squash.
4. Esperar o workflow "Deploy Production" terminar com sucesso. Não perguntar de novo ao Lucas.
5. Migração SQL: salvar em `supabase/migrations/` E aplicar manualmente no Supabase. O deploy NÃO aplica migração sozinho. Conferir depois.
6. Se a mudança mexer em tela, tabela, função SQL, rota ou regra de importação do GA, atualizar `docs/MAPA-GA.md` (seção 10 ou a seção correspondente) no MESMO PR. Mudança sem atualizar o mapa não está pronta.
7. O repositório é público: nada de dados de negócio, senhas ou chaves em arquivos.

## Banco de dados: regras
- Função SQL nova: `_v1`, `revoke ... from public, anon, authenticated`, `grant execute ... to service_role`.
- Alterar função existente: ler a definição atual antes e mudar só o necessário.
- Testar escrita com bloco `DO` terminado em `raise exception 'TESTE_OK'` (desfaz tudo).
- Apagar dados: mostrar contagem, pedir aprovação explícita e fazer backup antes. Nunca apagar por conta própria. Backups `bak_*` existentes só saem a pedido do Lucas.
- Nunca digitar nem pedir senhas. Trocar senha de administrador é o Lucas quem faz.

## Armadilhas já vividas
- Mesclar PR antes de todos os checks terminarem causou falha no Deploy Production.
- Migração esquecida: o código foi ao ar e a importação teria falhado.
- Alterar a curva ABC exige comparar resultado antigo x novo com vários casos (já aconteceu de divergir).
- Leituras do dashboard têm cache de 5 min (`READ_CACHE_TTL_SECONDS` em `src/ga/commerce-read-cache.js`); gravações zeram o cache; `?fresh=1` ignora.
- Regras da importação Shopee: confirmado = status válido E pagamento; cancelados (ML e Shopee) ficam fora. Full = "Pedido FBS" = Yes ou "Opção de envio" = Full.
- A view `commerce_current_sales_listing_daily_v1` é usada por todas as telas de vendas; mexer nela afeta tudo.
- Avisos de segurança: só POST em `/admin-login` conta como login.
