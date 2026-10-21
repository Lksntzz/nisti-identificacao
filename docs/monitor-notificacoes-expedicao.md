# NISTI Notificações — computador do monitor

A área de expedição usa um **notebook Windows**, com internet e alto-falantes, conectado ao monitor quando necessário. O sistema fica na URL:

https://nisti-identificacao.lksntz1411.workers.dev/monitor-notificacoes

## Conexão pelo painel de envio

No painel privado `/painel-expedicao`, a seção **Status da transmissão** mostra **Conectar**. O clique solicita ao servidor que o monitor NISTI **já aberto no notebook** atualize sua conexão; não precisa entrar no ADM. A presença online é verificada pelo heartbeat real do notebook a cada 2 segundos. Se estiver offline, o painel informa que o navegador precisa ser aberto e oferece **Copiar link do monitor**. Essa ação não liga o notebook nem abre o navegador remotamente.

Apenas usuários autenticados com o link privado de envio podem usar o endpoint `POST /api/expedition-panel/connect`. O monitor consulta um sinal revogável no banco via `nisti_dispatch_public_next_v7`, reinicia a página somente quando o sinal muda e continua exibindo as mensagens da fila sem alterar o histórico.

## URLs separadas da operação

- **Painel de envio sem senha:** abre diretamente pelo link privado
  `https://nisti-identificacao.lksntz1411.workers.dev/convite-expedicao/CHAVE_PRIVADA`.
  A chave deve ser entregue apenas à equipe autorizada. Na primeira abertura, o servidor valida a chave e devolve uma página de
  transição no mesmo domínio, com cookie HttpOnly Secure SameSite=Strict
  válido por 30 dias. Essa página abre automaticamente o endereço sem chave.
  O token jamais aparece no HTML da resposta. Quando expirar,
  basta abrir novamente o link privado. Sem chave e sem cookie, o painel
  apresenta apenas uma mensagem de acesso restrito.
  Esta tela exibe **Enviar notificações**, **Fila e histórico** e **Personalizar informações**.
  Os responsáveis pelo envio podem adicionar, remover e salvar modalidades por plataforma,
  sem acesso às APIs administrativas, ao envio fora do escopo autorizado ou ao catálogo.
- **Configurações da expedição (ADM):** continuam protegidas por senha administrativa,
  em `/admin`, Comunicação → Notificações da Expedição. A edição das modalidades
  também está disponível no painel de envio. O monitor não usa pareamento nem credenciais.
- **Monitor de exibição (notebook):**
  `https://nisti-identificacao.lksntz1411.workers.dev/monitor-notificacoes`
  Exibe notificações e reproduz os alertas **sem login, chave, código ou aprovação**. O painel mantém cada aviso por **15 segundos**, com **som de até 13 segundos**, repetindo o toque exclusivo da plataforma; se o navegador começar a receber a chamada atrasado, o som é limitado ao tempo restante da tela. O Edge precisa permitir autoplay de áudio.
  Apenas a visualização é pública; o envio e as ferramentas administrativas permanecem protegidos.

A URL curta **/painel-expedicao** sozinha não concede acesso: precisa estar com
a sessão ativada por link privado. O valor `DISPATCH_SENDER_TOKEN_SHA256` em `wrangler.toml` contém somente o
SHA-256 de um token aleatório de 256 bits. O token privado NUNCA entra no
repositório. O hash é um verificador unidirecional e é enviado ao Worker em
cada deploy da aplicação; não é preciso configurar uma variável manualmente. Para revogar o link e todos os cookies associados, substitua
o SHA-256 em `wrangler.toml` pelo digest de outra chave aleatória e publique
um novo deploy; os acessos anteriores deixarão de funcionar.

Todas as telas compartilham a mesma fila no Supabase. Não há atualização do
instalador Windows para este painel; ele é acessado pelo navegador.

## Configuração do notebook em Modo Quiosque

1. Nas configurações do Windows, selecione **Microsoft Edge → Quiosque como um sinal digital ou display interativo**.
2. Na **URL do site**, informe `https://nisti-identificacao.lksntz1411.workers.dev/monitor-notificacoes`.
3. Em **Reinicie o Microsoft Edge após a inatividade**, escolha **Nunca**.
4. Salve e abra a conta Windows do Quiosque. A tela abrirá diretamente em **Aguardando solicitações**.
5. Faça uma chamada de teste pelo painel de envio autorizado e confira a exibição e o áudio.

**Não existe ativação nem aprovação de notebook.** As sessões InPrivate do Edge não
atrapalham o funcionamento, pois a consulta de exibição não depende de cookie.

**Privacidade:** qualquer pessoa com a URL poderá acompanhar as chamadas operacionais.
O endpoint público entrega somente a chamada atual e o tamanho da fila, sem
permitir criar chamadas, alterar modalidades ou entrar no ADM. A primeira consulta
de exibição inicia os 15 segundos da chamada pendente; múltiplas telas compartilham
a mesma chamada e não a consomem repetidamente. Por isso, use o link somente
nos dispositivos de operação que devem acompanhar as notificações.

## Som sem botão de ativação

O arquivo de inicialização abre o Edge em janela de aplicativo fullscreen com
`--autoplay-policy=no-user-gesture-required`. Assim o contexto de áudio pode
começar sem gesto humano. O site tenta iniciar o áudio automaticamente e toca
um som para cada chamada recebida, por 15 segundos de exibição.

Browsers padrão **podem bloquear o som**; se o monitor mostrar "Áudio bloqueado
pelo navegador", verifique se o launcher foi utilizado, o volume do Windows,
o dispositivo de saída e as políticas corporativas em `edge://policy`.

Opção administrada sem argumento de execução: aplicar a política empresarial
`AutoplayAllowlist` ao domínio do NISTI, conforme a documentação da Microsoft:
https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/autoplayallowlist

## Modo Quiosque ou inicializador próprio?

O **Modo Quiosque** é compatível com a tela livre do NISTI; ao reiniciar,
não será preciso autorizar novamente. O arquivo `abrir-monitor-nisti.cmd`
continua sendo alternativa para abrir uma janela em tela cheia com
política de áudio automático, caso o Edge do Quiosque bloqueie os sons.

## Operação

- A fila vem do Supabase; não é mantida apenas no computador.
- Cada chamada aparece durante 15 segundos, sequencialmente, e some automaticamente.
- Quando a conexão falha, o monitor indica desconexão; ao reconectar, busca o próximo item.
- O painel ADM mostra a última comunicação do monitor.
- O monitor é uma tela pública de exibição. Não existem códigos ou solicitações de aprovação.


## Abertura automática após desligar o monitor e reiniciar

Se somente a tela for desligada, mantenha o PC ligado e sem suspensão. Ao
ligar a tela, a janela aberta do Edge continuará exibindo o painel.

Para que a janela também abra quando o Windows entrar na sessão do operador,
mantenha os dois arquivos CMD na mesma pasta e execute uma vez o instalador:
**scripts/instalar-monitor-nisti.cmd**. Ele copia o inicializador para a pasta
Startup do usuário Windows e abre o Edge imediatamente. Após reiniciar o PC,
o Edge abrirá novamente **quando esse usuário entrar no Windows**, com seu
perfil preservado.

Para cancelar, execute **scripts/remover-inicializacao-monitor-nisti.cmd**.
Não há pareamento para remover.

**Limites físicos:** software web não liga monitor desconectado da energia,
não inicia computador fisicamente desligado e não faz login sozinho no Windows.
Para perda de energia, procure as opções BIOS/UEFI 'Restore AC Power Loss' para
o PC e 'Auto Power On' para a tela, se disponíveis. Mantenha um usuário Windows
dedicado com sessão iniciada durante o expediente, sem suspender o computador.


## Sons diferentes para cada plataforma

As dez filas possuem sequencias de notas distintas, inclusive **Mercado Livre
Antigo**, **Mercado Livre Novo** e **Mercado Livre**. Cada chamada toca uma
vez ao entrar na tela. O audio e sintetizado pelo navegador: nao ha arquivos
de som externos ou dependencias de terceiros. Se o Windows ou o navegador
bloquear a reproducao, a interface informa "Audio bloqueado pelo navegador";
o perfil Edge iniciado pelo CMD ja usa a politica de autoplay autorizada.

## Atualizacao online automatica do terminal Windows

O **sistema NISTI já é online**: o notebook abre a pagina hospedada no Cloudflare,
nao uma copia do aplicativo extraida do ZIP. Os arquivos CMD servem apenas
para abrir o Microsoft Edge em tela cheia, com perfil persistente, audio
autorizado e inicializacao quando o Windows entra na conta dedicada.

**Instale o inicializador uma unica vez.** Depois disso, alteracoes de
frontend publicadas em producao nao exigem copiar, extrair nem reinstalar
o ZIP. O monitor consulta `/monitor-build.json` a cada 60 segundos para
identificar se o servidor possui uma nova versao. Quando ha uma versao nova,
ele so recarrega a pagina se estiver **conectado e sem chamada na tela
nem itens na fila**, respeitando ainda 15 segundos de ociosidade. Assim, nao
interrompe as solicitações de expedição. Nenhuma credencial de monitor é necessária entre recargas e reinícios.

Sem conexao com a internet o monitor nao instala atualizacoes nem recebe
novas chamadas em tempo real. Ao reconectar, a fila e a verificacao de
versao voltam a funcionar. O reinicio do Windows continua sendo tratado
separadamente pela conta dedicada e pelo atalho da pasta Startup.

**Excecao:** alteracoes futuras no proprio `abrir-monitor-nisti.cmd` ou
nas politicas do Windows podem exigir atualizacao do inicializador uma
vez, mas nao cada publicacao do site.

## Formato e edição das opções

A informação universal **RETIRAR CAPA** aparece em todas as plataformas e
não pode ser excluída. Selecionar MERCADO LIVRE + Full exibirá **MERCADO LIVRE
RETIRAR CAPA FULL**. O título da plataforma será menor, para não duplicar
visualmente a chamada.

Nos painéis administrativo e de envio, clique em **Personalizar informações**,
escolha a plataforma e adicione/remova as modalidades que utiliza; salve.
Full não precisa estar disponível em canais que não utilizam o serviço.
As preferências ficam guardadas no Supabase e são compartilhadas entre o ADM e os
responsáveis pelo envio. Não modificam o catálogo comercial. O histórico existente é preservado.

## Confirmação de cada envio (painel do responsável)

Após cada tentativa de enviar notificações, a página `/painel-expedicao` mostra uma janela central obrigatória, com botão **Entendi**, para evitar mensagens escondidas pelo layout sem rolagem: **Notificação enviada à fila** somente após confirmação de todas as IDs no retorno do servidor, **Notificação não enviada** quando houver bloqueio/validação/rejeição, ou **Envio não confirmado** quando a requisição pode ter sido recebida mas a resposta falhou. A confirmação lista as plataformas e informações selecionadas; o operador deve conferir **Fila e histórico** no estado incerto antes de tentar de novo. Envio confirmado significa inclusão na fila, não prova de que o monitor exibiu a mensagem ou de que alguém retirou a capa.
