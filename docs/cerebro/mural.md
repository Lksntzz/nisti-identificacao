# Mural NISTI

Feed de novidades para os operadores: produtos novos, coleções e avisos. Fica em `mural.sistemanistiid.online` (também em `/mural` no host principal). É separado do scanner/ID e do GA.
Conformidade com o PDP original: [[mural-pdp-compliance]] (parte dela está velha, veja "Armadilhas").

## O que faz

- **Feed do operador:** filtros Tudo / Produtos / Coleções / Avisos, paginação por cursor, "não lidas" por operador e marcar tudo como lida.
- **Admin (editorial):** cria rascunho, agenda, publica, arquiva; gerencia coleções (ordem dos produtos, banner); cuida das imagens tratadas dos produtos; mostra métricas básicas.
- **Push:** ao publicar, avisa os operadores inscritos. Um cron reenvia publicações agendadas e falhas passageiras.
- **Rascunho automático de EAN:** produto novo com imagem tratada aprovada e EAN válido gera um rascunho de aviso. Nunca publica sozinho.

## Caminho de um dado

- **Operador:** tela (`src/mural-nisti.jsx`, `src/mural-standalone.jsx`) → `/api/mural/...` → `handleMuralRequest` (`src/mural-router.js`) → função SQL `nisti_*mural*_vN` via `supabaseRpc`.
- **Admin:** telas em `src/admin/Mural*.jsx` → `/api/admin/mural/...` → mesmo router, delegando para `mural-post-routes.js`, `mural-collection-routes.js` e `mural-image-routes.js`.
- **Imagens:** o binário vai para o R2 (binding `PRODUCT_IMAGES`, chaves `mural/...`); o banco guarda só a chave. A tela lê por `/api/product-images/...?v=<chave>`.
- A autenticação fica no `src/edge-router.js`, não no Mural. O Mural só lê o operador do cabeçalho `x-user-id` (formato `op_<uuid>`).

## Leitura e escrita: dois caminhos (migração em andamento)

O código ainda tem o caminho antigo (D1) ao lado do Supabase. A escolha é por configuração: leituras via `preferSupabaseRead`, escritas via `mirrorSupabaseRpc` (modos off / espelho / primary em `supabase-write-store.js`). Qual modo está ativo em produção: **não confirmado** no código; conferir nas variáveis do Worker antes de assumir. Mudou uma regra? Ela precisa ser mudada nos dois caminhos enquanto o D1 existir.

## Regras de negócio

- **Produto no feed usa dados atuais** (junção com `products`), não cópia. Se o produto some, o card vira `product_available:false` em vez de quebrar.
- **Só entra no feed:** publicado, dentro da janela (`published_at` já passou, `expires_at` não), não arquivado. Destaque e prioridade mandam na ordem; o cursor carrega esses campos.
- **Imagem tratada do produto só vale se aprovada por admin** e se foi gerada a partir da imagem atual (`mural_source_image_key` = `image_key`). Trocou a foto do produto, a tratada antiga deixa de valer, de propósito.
- **Imagem editorial:** JPEG/PNG/WebP, até 5 MB, tipo conferido pelo conteúdo (não só pelo que o navegador diz), chave aleatória no servidor. Trocar a imagem apaga a chave antiga; por isso o rascunho de EAN **copia** a imagem em vez de apontar para a do produto.
- **Imagem pública respeita a visibilidade:** só serve se o post está publicado e na janela, ou a coleção está ativa.
- **Erros internos não vão para o operador:** mensagem genérica na tela, detalhe só no log.
- **Fundo transparente das fotos** (`src/mural-transparent-image.js`) é processamento pesado e calibrado por tentativa e erro (comentários de versões no arquivo). Não há máscara fixa por produto, porque produtos da mesma cor de wire-o têm silhuetas diferentes.

## Armadilhas

- **Trava de liberação:** `MURAL_PUBLIC_RELEASED` em `mural-router.js`. Hoje está `true`. Com `false`, o operador vê "em breve", o push e o cron não enviam nada (nem para admin). O doc [[mural-pdp-compliance]] ainda fala em "Em breve"; vale o código.
- Falha no push **não** pode desfazer a publicação (já salva): o erro só vai para o log.
- O rascunho de EAN nunca pode travar a ação que o disparou; falhas só vão para o log e para a notificação do admin.
- Cursor inválido devolve 400, não lista vazia.
- Leitura de lido é idempotente; não conte duas vezes.

## Cuidados ao mexer

- Função SQL nova: `_v1`, revogar de `public, anon, authenticated`, conceder a `service_role`. Alterar existente: ler a definição atual antes.
- Mural tem push: testar publicação sem mandar notificação real para os operadores.
- Imagem: não mudar o formato das chaves do R2 (`mural/<dono>/<id>/<uuid>`) sem plano para as já gravadas.
- Mexeu em tela ou rota? Conferir os testes do router e atualizar esta nota no mesmo PR.

## Arquivos principais

- `src/mural-router.js`: entrada, feed, unread, push e cron (`dispatchScheduledMuralNotifications`).
- `src/mural-post-routes.js`, `mural-collection-routes.js`, `mural-image-routes.js`: admin de posts, coleções e imagens.
- `src/mural-ean-announcement.js`: rascunho automático de EAN.
- `src/mural-transparent-image.js`: fundo transparente das fotos.
- `src/mural-nisti.jsx` (feed), `src/admin/Mural*.jsx` (admin), `src/mural-*.css`.
- Push em geral: `src/web-push.js`.

Fluxo de publicação: [[deploy]].
