# Notificações (nova capa, push e sino do admin)

"Notificação" tem **quatro** significados no sistema. Esta nota cobre os três primeiros; confundir um com outro é fonte de erro.

| O que é | Quem recebe | Onde está documentado |
|---|---|---|
| **Aviso de nova capa** (lista no app + push no celular) | operadores | esta nota |
| **Push (Web Push)**: o aviso que chega no aparelho, inclusive de novo post do Mural | operadores inscritos | esta nota e [[mural]] |
| **Sino do admin** (atividade do sistema: logins, cadastros, erros) | admin | esta nota |
| **Chamada da expedição** (tela do notebook com som) | equipe de expedição | [[expedicao-monitor]] |

## Caminho de um dado

- **Nova capa:** cadastro de produto (`POST /api/products`, `src/core/core-router.js`) → o banco registra o aviso (`nisti_record_new_cover_notification_v1`, em `src/ga/cover-notifications.js`) → se foi a **primeira** vez que aquela capa aparece, `scheduleNewCoverPush` dispara o push em segundo plano. O cadastro não espera o push.
- **Lista do operador:** `GET /api/notifications` e `/api/notifications/unread-count` (lidos por aparelho, pelo id `op_<uuid>` do cookie do operador), `POST .../<id>/read` e `.../mark-all-read`. A tela consulta as não lidas a cada 60 s (`src/public-main.jsx`).
- **Inscrever o aparelho no push:** `POST /api/push/subscribe` grava a assinatura (`nisti_upsert_push_subscription_v1`); `/api/push/unsubscribe` remove a do próprio aparelho; `/api/push/status` diz se este aparelho está registrado; `/api/push/public-key` entrega a chave pública.
- **Envio do push:** `src/core/web-push.js` (`broadcastNewCoverPush`, `broadcastMuralPush`) assina com VAPID, criptografa o conteúdo e manda para cada assinatura. O aparelho recebe pelo service worker (`public/sw.js`).
- **Sino do admin:** `src/operator-audit-router.js` olha cada resposta da API e, para login, logout, leitura de EAN e qualquer gravação, chama `recordAdminActivityFromResponse` (`src/core/system-notifications.js`). A lista e o contador ficam em `/api/admin/system-notifications*`; a tela é `src/admin/AdminNotificationsModal.jsx`.

## Regras de negócio

- **Nova capa avisa uma vez só.** Só a primeira criação daquela capa no banco dispara aviso e push; recadastrar a mesma capa não repete.
- **Falha no push nunca desfaz o cadastro.** O erro vai só para o log.
- **Sem a chave privada VAPID o push não sai** e não dá erro visível: a função devolve `skipped`. A chave privada é segredo do Cloudflare (`VAPID_PRIVATE_KEY`); a pública pode ser vista.
- **Assinatura morta é apagada sozinha:** se o serviço de push responde 404 ou 410, o endereço é removido.
- **Endereço de push é validado** (`safePushEndpoint`): só https de provedores conhecidos, nada de `localhost`, rede interna ou credenciais embutidas. Existe para impedir que o servidor seja usado para chamar endereços internos.
- **O que entra no sino do admin:** login (só o `POST`, ver [[login-seguranca]]), logout, toda leitura de EAN do scanner e toda gravação de API. **Não entra:** 404/405 (robôs sondando), a consulta de fila da expedição que deu certo, as rotas de leitura de avisos e de inscrição de push (para não gerar aviso de aviso).
- **Mural só envia push se estiver liberado** (`MURAL_PUBLIC_RELEASED`, ver [[mural]]).

## Armadilhas

- **Toda leitura do scanner vira uma linha no sino do admin.** Em dia de muita expedição isso é muito volume (além do evento de leitura de [[id-catalogo]]). Qualquer mudança que aumente leituras aumenta gravações no banco.
- **A identidade do aparelho vale 12 h.** O cookie do operador expira e o aparelho ganha um id novo ([[login-seguranca]]). Como a assinatura de push e a lista de não lidas são ligadas ao id, `/api/push/status` pode passar a dizer "não registrado" e as não lidas podem recomeçar. Isso vem da leitura do código; **não testei** o efeito real em celular.
- **Domínio fixo no código:** a imagem do push usa o endereço `workers.dev` escrito direto em `broadcastNewCoverPush`. Se o domínio principal mudar, a imagem do aviso quebra.
- **Para testar push sem incomodar a equipe:** `GET /api/admin/push/debug` mostra se a chave está configurada e quantas assinaturas ativas existem, sem enviar nada. Disparar um push de verdade avisa todos os aparelhos inscritos.
- **Mudar o service worker** (`public/sw.js`) afeta todas as telas já abertas; ele tem uma versão de cache no topo. Testar no celular real.
- Apagar assinaturas ou avisos de produção segue a regra do banco: contagem, aprovação e backup antes ([[backup]]).

## Cuidados ao mexer

- Função SQL nova: `_v1`, só `service_role` ([[deploy]]); migração é aplicada à mão.
- Não gravar dado de negócio (valores, clientes) no texto do aviso: o sino mostra caminho de rota, status e nome de operador.
- Mexeu em tela, rota ou regra de aviso? Atualizar esta nota no mesmo PR.

## Arquivos principais

- `src/ga/cover-notifications.js`: aviso de nova capa e lista do operador.
- `src/core/web-push.js`: VAPID, validação de endereço, criptografia e envio (capa e Mural).
- `src/core/system-notifications.js`: sino do admin (o que registrar e como descrever).
- `src/core/core-router.js`: rotas `/api/notifications*`, `/api/push/*` e `/api/admin/system-notifications*`.
- `src/operator-audit-router.js`: ponto onde cada resposta é registrada.
- `src/admin/AdminNotificationsModal.jsx`, `src/public-main.jsx`: telas.
- `public/sw.js`: service worker que recebe o push.
