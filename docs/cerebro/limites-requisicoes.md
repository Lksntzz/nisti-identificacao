# Erro "Muitas requisições. Tente novamente em instantes."

É o **limitador de pedidos da Cloudflare** respondendo HTTP 429 com `retry-after: 60`. O bloqueio dura cerca de 60 segundos; esperar um minuto resolve na hora.

## Onde está no código

- `src/edge-router.js`: `enforceRateLimit` (cada IP tem um balde por escopo; chave `escopo:IP`).
- `src/ga/ga-access.js`: helper `limit` com a mesma mensagem, para a API do GA.
- `wrangler.toml`, blocos `[[ratelimits]]`.

## Limites (por IP, janela de 60 s)

| Escopo | Limite | Vale para |
|---|---|---|
| Geral (`GLOBAL_RATE_LIMITER`) | 1200 (era 600 até 10/11/2026) | todo `/api/` que não tenha limite próprio |
| Login | 10 | só POST em `/admin-login` |
| Fila da expedição | 300 | POST `/api/dispatch/view` (monitor consulta a cada 2 s) |
| Arte no Canva | 6 | POST `/api/admin/canva/art/create` |

Como a conta é **por IP**, vários computadores/abas na mesma rede dividem o mesmo limite geral. Em uma tela só, a mensagem é a mesma para os quatro escopos: não dá para saber qual estourou olhando o erro.

## Telas que consultam o servidor sozinho (polling)

Monitor da expedição a cada 2 s; visão de expedição a cada 8 s; tela do Mural a cada 30 s; avisos não lidos a cada 60 s; métricas do painel a cada 5 min. O monitor já causou este erro antes, por isso ganhou limite próprio.

## Caso investigado: erro ao clicar em "Publicar" no Mural (admin)

- Publicar faz só 2 a 4 pedidos, mais ~4 de recarga. Não estoura o limite geral sozinho: o balde já estava cheio por outra causa.
- **Hipótese descartada:** o seletor de produtos carregar 500 fotos. A lista mostra no máximo 6 (publicação de produto) ou 10 (coleção) fotos.
- **Achado:** as imagens editoriais do Mural vistas pelo admin respondem `private, no-store` (`serveEditorialImage` em `src/mural/mural-image-routes.js`, com `isPublic:false`). Cada redesenho da lista rebaixa todas as miniaturas. É decisão deliberada, travada por teste (`test/mural-image-routes-extraction.test.js`). A URL já é versionada por `?v=`, então cacheável em tese, mas não mexer sem aprovação.
- **Correções de 10/11/2026 (o erro ainda não tinha causa confirmada):** (1) limite geral subiu de 600 para 1200; (2) o Worker agora **registra cada 429** (`console.warn` com limitador, método e rota, sem IP) e os logs estão ligados em `[observability]` no `wrangler.toml` (plano gratuito: 200 mil eventos/dia, 3 dias; `invocation_logs=false` para só gastar a cota com o que o código escreve); (3) o Publicar guarda o id do post já criado, então um 429 no meio (imagem ou publicação) e um novo clique **atualizam** o post em vez de criar duplicado; (4) mensagem própria no Publicar para 429.
- **Como achar a causa da próxima vez:** no painel da Cloudflare, Workers → o Worker → Logs, procurar `[Rate limit] 429`. O campo `limiter` diz qual limite estourou e `path` qual rota.
- **Causa real: não confirmada.** Sem acesso aos logs da Cloudflare, não dá para saber qual escopo estourou nem o que gastou o limite.

## Se acontecer de novo

1. Esperar 60 s.
2. Anotar: logo após qual ação, quantas abas/computadores abertos, se repetiu depois de esperar.
3. Proposta ainda não implementada: registrar em log o caminho e o escopo toda vez que um pedido for bloqueado (não muda comportamento nem limites). Com isso a próxima ocorrência diz exatamente o que gasta o limite.

## Não fazer

Subir os limites sem saber a causa: esconde o problema. Os limites protegem o sistema.
