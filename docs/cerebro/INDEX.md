# Cérebro do NISTI — comece por aqui

Notas curtas para a IA (e para o Lucas) acharem o assunto certo sem ler o código inteiro.
Abra **só a nota do assunto** em que for trabalhar.

## Notas disponíveis

| Assunto | Nota | Quando ler |
|---|---|---|
| GA (Gestor de Anúncios) | [[ga]] | Qualquer mudança em telas, vendas, importação ou comparação anual do GA |
| Publicar mudanças | [[deploy]] | Antes de abrir PR, mesclar ou aplicar migração |
| Mural NISTI | [[mural]] | Feed, publicações, coleções, imagens do Mural e push |
| Backup do banco e imagens | [[backup]] | Fazer, conferir ou planejar backup (hoje sem backup confirmado) |
| Erro "Muitas requisições" | [[limites-requisicoes]] | Erro 429, painel travando, telas que consultam o servidor sem parar |

## Índice de arquivos (gerado, sempre atual)

`npm run cerebro` cria `docs/cerebro/_gerado/arquivos.md`: todos os arquivos de `src/` agrupados por área, com linhas e uma descrição curta (do comentário no topo do arquivo ou dos exports). Não é versionado, então nunca fica velho nem gera conflito. **A IA deve rodá-lo quando precisar achar onde algo está**, em vez de varrer o código. Para a descrição ficar boa, comece arquivos novos com uma linha `// o que este arquivo faz`.

## Notas que ainda não existem (a fazer, uma por vez)

ID/scanner e catálogo, importação Shopee/ML, expedição e monitor, notificações, login e segurança.
Enquanto não existirem, a fonte é o código e os arquivos de `docs/` (ex.: [[monitor-notificacoes-expedicao]]).

## Pendências conhecidas (resolver e apagar daqui)

- **Backup:** nenhuma cópia do banco confirmada; primeira exportação nunca registrada. Ver [[backup]].
- **Limite de requisições:** causa do erro "Muitas requisições" no Publicar do Mural não confirmada. Ver [[limites-requisicoes]].

## Outros documentos em `docs/`

Organizados em pastas para a lista do Obsidian não ficar poluída. Os links `[[nome]]` funcionam sem importar a pasta.

- `docs/` (raiz): só o [[MAPA-GA]], o mapa vivo do GA (o `CLAUDE.md` aponta para ele).
- `docs/referencia/` (atuais, consultar e manter):
  - [[supabase-cutover-a2-inventory]]: arquitetura atual de produção (Supabase principal, D1 só legado).
  - [[monitor-notificacoes-expedicao]] e [[notification-platform-logos]]: monitor da expedição e origem dos logos das plataformas (registro de proveniência: manter).
  - [[PLANO-PROTECAO-E-RECUPERACAO]]: proteção da `main` e recuperação.
  - [[EXPORTAR-IMAGENS-ORIGINAIS-SUPABASE]]: exportador manual de imagens.
- `docs/historico/` (retrato de uma data, não atualizar):
  - [[AUDITORIA-D1-INDICES-MIGRACOES-2026-10-21]]: mantida porque registra cinco índices ainda pendentes.
  - [[SECURITY_AUDIT_2026-10-07]]: auditoria de segurança.

## Regras destas notas

1. **Curtas.** Uma nota = um assunto. Se passar de ~100 linhas, dividir.
2. **Sem números que mudam** (quantidade de arquivos, de testes, de funções). Eles envelhecem na primeira mudança. Quem precisa do número, conta no código.
3. **Explicar o porquê**, não repetir o código. O código mostra o quê.
4. **Mudou o código de uma área? Atualize a nota dela no MESMO PR.** Nota velha é pior que nenhuma.
5. **Se a nota divergir do código, vale o código** e a nota deve ser corrigida.
6. **O repositório é público:** nada de dados de negócio (vendas, clientes), senhas, chaves ou IPs.
