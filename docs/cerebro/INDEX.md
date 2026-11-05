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

## Notas que ainda não existem (a fazer, uma por vez)

ID/scanner e catálogo, importação Shopee/ML, expedição e monitor, notificações, login e segurança.
Enquanto não existirem, a fonte é o código e os arquivos de `docs/` (ex.: [[monitor-notificacoes-expedicao]], [[catalogo-comercial-v1]]).

## Pendências conhecidas (resolver e apagar daqui)

- **Backup:** nenhuma cópia do banco confirmada; primeira exportação nunca registrada. Ver [[backup]].
- **Limite de requisições:** causa do erro "Muitas requisições" no Publicar do Mural não confirmada. Ver [[limites-requisicoes]].

## Documentos antigos em `docs/`

**Atuais** (consultar e manter; vários têm teste ou código que dependem deles):
- [[MAPA-GA]]: mapa completo do GA.
- [[supabase-cutover-a2-inventory]]: arquitetura atual de produção (Supabase principal, D1 só legado).
- [[monitor-notificacoes-expedicao]] e [[notification-platform-logos]]: monitor da expedição e logos das plataformas.
- [[catalogo-comercial-v1]]: desenho do catálogo comercial.
- [[PLANO-PROTECAO-E-RECUPERACAO]]: proteção da `main` e recuperação.
- [[EXPORTAR-IMAGENS-ORIGINAIS-SUPABASE]]: procedimento do exportador de imagens (workflow manual).

**Históricos** (retrato de uma data; não atualizar):
- [[AUDITORIA-D1-INDICES-MIGRACOES-2026-10-21]]: mantida porque registra cinco índices ainda pendentes de revisão.
- [[SECURITY_AUDIT_2026-10-07]]: auditoria de segurança.

## Regras destas notas

1. **Curtas.** Uma nota = um assunto. Se passar de ~100 linhas, dividir.
2. **Sem números que mudam** (quantidade de arquivos, de testes, de funções). Eles envelhecem na primeira mudança. Quem precisa do número, conta no código.
3. **Explicar o porquê**, não repetir o código. O código mostra o quê.
4. **Mudou o código de uma área? Atualize a nota dela no MESMO PR.** Nota velha é pior que nenhuma.
5. **Se a nota divergir do código, vale o código** e a nota deve ser corrigida.
6. **O repositório é público:** nada de dados de negócio (vendas, clientes), senhas, chaves ou IPs.
