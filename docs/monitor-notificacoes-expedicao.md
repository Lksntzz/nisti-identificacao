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


## Abertura automática após desligar o monitor e reiniciar

Se somente a tela for desligada, mantenha o PC ligado e sem suspensão. Ao
ligar a tela, a janela aberta do Edge continuará exibindo o painel.

Para que a janela também abra quando o Windows entrar na sessão do operador,
mantenha os dois arquivos CMD na mesma pasta e execute uma vez o instalador:
**scripts/instalar-monitor-nisti.cmd**. Ele copia o inicializador para a pasta
Startup do usuário Windows e abre o Edge imediatamente. Após reiniciar o PC,
o Edge abrirá novamente **quando esse usuário entrar no Windows**, com seu
perfil e chave preservados.

Para cancelar, execute **scripts/remover-inicializacao-monitor-nisti.cmd**.
O pareamento não é excluído.

**Limites físicos:** software web não liga monitor desconectado da energia,
não inicia computador fisicamente desligado e não faz login sozinho no Windows.
Para perda de energia, procure as opções BIOS/UEFI 'Restore AC Power Loss' para
o PC e 'Auto Power On' para a tela, se disponíveis. Mantenha um usuário Windows
dedicado com sessão iniciada durante o expediente, sem suspender o computador.

## Formato e edição das opções

A informação universal **RETIRAR CAPA** aparece em todas as plataformas e
não pode ser excluída. Selecionar MERCADO LIVRE + Full exibirá **MERCADO LIVRE
RETIRAR CAPA FULL**. O título da plataforma será menor, para não duplicar
visualmente a chamada.

No painel administrativo, clique em **Personalizar informações → Configurar**,
escolha a plataforma e adicione/remova as modalidades que utiliza; salve.
Full não precisa estar disponível em canais que não utilizam o serviço.
As preferências ficam guardadas no Supabase para todos os administradores
e não modificam o catálogo comercial. O histórico existente é preservado.
