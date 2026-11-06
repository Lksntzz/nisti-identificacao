# Expedição e monitor de notificações

Quando chega um pedido que exige retirar a capa do caderno, a equipe de envio manda um aviso para uma tela no notebook da expedição, que mostra e toca um som. É um sistema de **chamadas em fila**, separado do scanner e do GA.

Esta nota é o resumo para se orientar. A instalação do notebook (Modo Quiosque, áudio, inicialização automática) está em [[monitor-notificacoes-expedicao]]. Notificações de novas capas e atividade do admin são outro assunto (ficam em `src/cover-notifications.js` e `src/core/system-notifications.js`).

## As três telas

| Tela | Rota | Quem usa | Acesso |
|---|---|---|---|
| **Painel de envio** | `/painel-expedicao` | responsáveis pelo envio | link privado `/convite-expedicao/<chave>` (cookie de 30 dias) |
| **Monitor** | `/monitor-notificacoes` | notebook da expedição | **público**, sem login |
| **Configurações** | `/admin` → Comunicação → Notificações da Expedição | admin | senha do admin |

Como cada acesso funciona por dentro: [[login-seguranca]].

## Caminho de um dado

- **Enviar:** painel (`src/expedicao/expedition-dispatch-standalone.jsx`, `src/expedicao/NotificationDispatchView.jsx`) → `POST /api/expedition-panel/batch` → o `expedition-dispatch-sender-router.js` confere o cookie e **traduz** para `/api/admin/dispatch/batch` → `handleNotificationDispatchRequest` (`src/expedicao/notification-dispatch-router.js`) → função SQL `nisti_dispatch_enqueue_batch_v4`.
- **Exibir:** monitor (`src/expedicao/notification-monitor.jsx`) → `POST /api/dispatch/view` a cada 2 s → `nisti_dispatch_public_next_v8`. O servidor decide qual chamada está no ar; o monitor só mostra.
- **Reconectar:** botão "Conectar" do painel → `nisti_dispatch_request_reconnect_v7` grava um sinal; o monitor percebe a mudança e recarrega a página sozinho.
- **Opções por plataforma:** lidas e salvas por `nisti_dispatch_options_v4` / `nisti_dispatch_save_options_v4`.
- A fila fica no Supabase, não no notebook.

## Regras de negócio

- **10 plataformas fixas** (`DISPATCH_PLATFORMS` em `src/expedicao/notification-dispatch-options.js`): Shopee, Mercado Livre Antigo, Mercado Livre Novo, Mercado Livre, Amazon, Shein, TikTok, Magalu, Kwai, Loja Integrada. Plataforma nova exige mexer no código, não só na tela.
- **Um aviso por plataforma por envio**; lote de 1 a 10. Duplicar a plataforma no mesmo lote é recusado.
- **"RETIRAR CAPA" sempre existe** e não pode ser apagada. As outras modalidades (Full, Flex etc.) são configuráveis por plataforma: até 16 por plataforma, 60 caracteres cada, sem repetição.
- **Texto exibido:** a modalidade "Full..." vira `<PLATAFORMA> RETIRAR CAPA FULL`; as demais, `<PLATAFORMA> RETIRAR CAPA <MODALIDADE>` (`formatDispatchText`).
- **A fila aceita no máximo 50 pendentes** (erro 409 `dispatch_queue_full`).
- **Cada chamada fica 15 segundos no ar**, uma de cada vez, com som sintetizado no navegador (cada plataforma tem sequência própria, até 13 s). Várias telas abertas compartilham a mesma chamada.
- **Idempotência:** cada chamada leva uma chave única. Se o envio falha no meio, repetir não duplica. A chave só é descartada com a confirmação do servidor.
- **O envio é conferido contra as opções atuais do banco** antes de enfileirar (a lista guardada na aba pode estar velha).
- **Confirmação de envio** só vale se o servidor devolve o id de TODAS as chamadas. "Enviado" significa "entrou na fila", não "o monitor mostrou" nem "alguém tirou a capa".
- **Histórico do monitor:** só as 8 últimas chamadas que já entraram em exibição; pendentes nunca aparecem.
- **Atualização do site:** o monitor consulta `/monitor-build.json` e só recarrega quando está conectado, sem chamada na tela e sem fila, para não cortar um aviso.

## Armadilhas

- **O monitor é público de propósito.** Quem tiver a URL vê a chamada atual, o tamanho da fila e as últimas 8. Não envia nada nem entra no admin. Não colocar dado sensível na resposta de `/api/dispatch/view`.
- **O monitor consulta a cada 2 s** e já causou o erro 429; por isso tem limite próprio (300/min). Qualquer tela nova que consulte a fila sem parar precisa pensar nisso: [[limites-requisicoes]].
- **Revogar o link do painel** = trocar `DISPATCH_SENDER_TOKEN_SHA256` no `wrangler.toml` por outro hash e publicar. O token em si nunca entra no repositório.
- **Áudio pode ser bloqueado pelo navegador.** O monitor mostra "Áudio bloqueado" e a solução está em [[monitor-notificacoes-expedicao]] (inicializador do Edge ou política de autoplay).
- **Não liga o computador.** "Conectar" só reinicia o monitor que já está aberto; notebook desligado, sem internet ou sem sessão do Windows aberta não recebe nada.
- **O documento de referência está desatualizado em um ponto** (o código manda): a função do monitor é `nisti_dispatch_public_next_v8` (o doc diz `_v7`).
- Domínio: o documento de referência usa o endereço `workers.dev`. Confirmar qual host o notebook realmente usa antes de mexer em URL.

## Cuidados ao mexer

- Mudou função SQL do despacho? Criar versão nova (`_vN`), nunca editar a antiga em uso, e aplicar a migração manualmente ([[deploy]]).
- Mudou o monitor? Testar com uma chamada real no notebook (som, 15 s, histórico). Há `scripts/monitor-live-smoke.mjs` para teste ao vivo.
- Teste de envio de verdade avisa a equipe: avisar antes, ou testar fora do expediente.
- Mexeu em tela, rota ou regra? Atualizar esta nota no mesmo PR.

## Arquivos principais

Tudo isto fica em `src/expedicao/` (pasta criada na reorganização do PR #874); os nomes abaixo sem prefixo estão lá.

- `src/expedicao/notification-dispatch-router.js`: rotas e validação do envio, opções e exibição.
- `src/expedicao/notification-dispatch-options.js`, `notification-dispatch-send.js`: plataformas, modalidades, texto e envio com chave de idempotência.
- `src/expedicao/expedition-dispatch-sender-router.js`: link privado e cookie do painel de envio.
- `src/expedicao/notification-monitor.jsx`, `notification-monitor-data.js`, `notification-monitor-updates.js`: tela do monitor, validação do que chega e atualização automática.
- `src/expedicao/notification-platform-sounds.js`, `notification-platform-logos.js`: som e logo por plataforma.
- `src/expedicao/NotificationDispatchView.jsx`, `src/expedicao/expedition-dispatch-standalone.jsx`: telas de envio.
- `scripts/abrir-monitor-nisti.cmd`, `instalar-monitor-nisti.cmd`, `remover-inicializacao-monitor-nisti.cmd`: inicializador do notebook.
