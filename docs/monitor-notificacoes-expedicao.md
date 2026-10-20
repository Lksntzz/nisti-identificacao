# NISTI Notificações — computador do monitor

A área de expedição usa um **monitor comum ligado por HDMI a um PC Windows ou mini PC**, com internet e alto-falantes (do monitor ou externos). O sistema fica na URL:

https://nisti-identificacao.lksntz1411.workers.dev/monitor-notificacoes

## Primeiro uso (apenas uma vez)

1. No painel administrativo NISTI, abra **COMUNICAÇÃO → Notificações da Expedição** e gere uma chave de ativação para o monitor.
2. No computador da expedição, execute `scripts/abrir-monitor-nisti.cmd`. O navegador usará um **perfil dedicado persistente**, separado de outros usos do Edge.
3. Insira a chave do monitor. O cookie HttpOnly ficará no perfil dedicado.
4. Confira no rodapé **Som automático pronto**. Envie uma chamada de teste pelo painel administrativo e ajuste o volume físico.
5. Adicione um atalho ao arquivo `abrir-monitor-nisti.cmd` na pasta `shell:startup` do **usuário Windows dedicado** para abrir no início da sessão. Não habilite logon automático sem avaliar segurança física.

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

## Por que não usar `msedge --kiosk` puro?

O modo quiosque do Edge é InPrivate, que não mantém o cookie de ativação depois
de fechar a sessão. Para manter a chave e evitar repareamento diário, este
launcher abre uma **janela de aplicativo com um perfil persistente**, não o modo
quiosque InPrivate. Não compartilhar esse perfil com outros computadores.

## Operação

- A fila vem do Supabase; não é mantida apenas no computador.
- Cada chamada aparece durante 15 segundos, sequencialmente, e some automaticamente.
- Quando a conexão falha, o monitor indica desconexão; ao reconectar, busca o próximo item.
- O painel ADM mostra a última comunicação do monitor.
- Não exponha a chave de ativação publicamente; gere outra se o computador for perdido.
