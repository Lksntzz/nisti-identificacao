# Cérebro do NISTI — comece por aqui

Notas curtas para a IA (e para o Lucas) acharem o assunto certo sem ler o código inteiro.
Abra **só a nota do assunto** em que for trabalhar.

## Notas disponíveis

| Assunto | Nota | Quando ler |
|---|---|---|
| GA (Gestor de Anúncios) | [[ga]] | Qualquer mudança em telas, vendas, importação ou comparação anual do GA |
| Publicar mudanças | [[deploy]] | Antes de abrir PR, mesclar ou aplicar migração |
| Mural NISTI | [[mural]] | Feed, publicações, coleções, imagens do Mural e push |
| Erro "Muitas requisições" | [[limites-requisicoes]] | Erro 429, painel travando, telas que consultam o servidor sem parar |

## Notas que ainda não existem (a fazer, uma por vez)

ID/scanner e catálogo, importação Shopee/ML, expedição e monitor, notificações, login e segurança.
Enquanto não existirem, a fonte é o código e os arquivos de `docs/` (ex.: [[monitor-notificacoes-expedicao]], [[catalogo-comercial-v1]]).

## Pendências conhecidas (resolver e apagar daqui)

- **Mural:** qual caminho de dados (D1 ou Supabase) está ativo em produção. Ver [[mural]].
- **Limite de requisições:** causa do erro "Muitas requisições" no Publicar do Mural não confirmada. Ver [[limites-requisicoes]].

## Documentos antigos que continuam valendo

- [[MAPA-GA]]: mapa completo do GA (telas, tabelas, funções, histórico de mudanças).
- [[PLANO-PROTECAO-E-RECUPERACAO]] e [[BACKUP-GRATUITO-NISTI]]: backup e recuperação.
- [[SECURITY_AUDIT_2026-10-07]]: auditoria de segurança.

## Regras destas notas

1. **Curtas.** Uma nota = um assunto. Se passar de ~100 linhas, dividir.
2. **Sem números que mudam** (quantidade de arquivos, de testes, de funções). Eles envelhecem na primeira mudança. Quem precisa do número, conta no código.
3. **Explicar o porquê**, não repetir o código. O código mostra o quê.
4. **Mudou o código de uma área? Atualize a nota dela no MESMO PR.** Nota velha é pior que nenhuma.
5. **Se a nota divergir do código, vale o código** e a nota deve ser corrigida.
6. **O repositório é público:** nada de dados de negócio (vendas, clientes), senhas, chaves ou IPs.
