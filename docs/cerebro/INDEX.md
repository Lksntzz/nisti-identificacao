# Cérebro do NISTI — comece por aqui

Notas curtas para a IA (e para o Lucas) acharem o assunto certo sem ler o código inteiro.
Abra **só a nota do assunto** em que for trabalhar.

## Notas disponíveis

| Assunto | Nota | Quando ler |
|---|---|---|
| GA (Gestor de Anúncios) | [[ga]] | Qualquer mudança em telas, vendas, importação ou comparação anual do GA |
| Publicar mudanças | [[deploy]] | Antes de abrir PR, mesclar ou aplicar migração |
| Mural NISTI | [[mural]] | Feed, publicações, coleções, imagens do Mural e push |
| Importação de planilhas (Shopee/ML) | [[importacao]] | Mexer em importação de vendas, catálogo, Full, reimportação |
| GA-019 (vendas por dia): **concluída em 24/11/2026**; registro, reversão e troca do segredo | [[ga-019-publicacao]] | Estado de encerramento, migração `20261123210000` (versão `20261124125421` no banco), segredo `COMMERCE_ORDER_KEY_SECRET`, PR #910, reverter, trocar o segredo |
| ID / scanner e catálogo | [[id-catalogo]] | Scanner de EAN, cadastro de produto, SKU, vínculo de EAN, gerador de código de barras |
| Login e segurança | [[login-seguranca]] | Senha do admin, sessões, link da expedição, CSRF, cabeçalhos, rotas protegidas |
| Expedição e monitor | [[expedicao-monitor]] | Painel de envio, monitor do notebook, fila de chamadas, som, link privado |
| Notificações | [[notificacoes]] | Aviso de nova capa, push no celular, sino do admin |
| Backup do banco e imagens | [[backup]] | Fazer, conferir ou planejar backup (hoje sem backup confirmado) |
| Erro "Muitas requisições" | [[limites-requisicoes]] | Erro 429, painel travando, telas que consultam o servidor sem parar |

## Índice de arquivos (gerado, sempre atual)

`npm run cerebro` cria `docs/cerebro/_gerado/arquivos.md`: todos os arquivos de `src/` agrupados por área, com linhas e uma descrição curta (do comentário no topo do arquivo ou dos exports). Não é versionado, então nunca fica velho nem gera conflito. **A IA deve rodá-lo quando precisar achar onde algo está**, em vez de varrer o código. Para a descrição ficar boa, comece arquivos novos com uma linha `// o que este arquivo faz`.

## Pastas de código por módulo (reorganização em andamento)

Etapa 1 feita: tudo da **expedição e monitor** (notificação para a expedição) está em `src/expedicao/` (rotas `notification-dispatch-*`, `expedition-dispatch-*`, monitor, telas `ExpeditionDashboard` e `NotificationDispatchView`, `notification-ui/`). As entradas (`src/operator-audit-router.js`, `src/edge-router.js`, `src/entry.jsx`, `src/main.jsx`) continuam em `src/`. Etapa 2 feita: tudo do **escâner** (`gtin*`, `ean-*`, overlay e CSS do escâner, `BarcodeGeneratorView`, `GtinEventsView`) está em `src/scanner/`. Etapa 3 feita: tudo do **Mural** (`mural-*` e as telas `Mural*` do painel) está em `src/mural/`. Etapa 4 feita: `src/core/` (Supabase, rotas centrais, datas, SKU, push, notificações do sistema), `src/imagens/` (Canva, recorte e tratamento de imagem, imagens públicas) e `src/admin/` (agora também o menu e a tela de saúde). Na raiz de `src/` ficam só as entradas (`operator-audit-router.js`, `edge-router.js`, `entry.jsx`, `main.jsx`, `public-main.jsx`) e os CSS globais. Etapa 5 feita: todo o GA (`commerce-*`, `ga-access`, `nisti-commerce-sync`, `cover-notifications`) está em `src/ga/`. Reorganização por módulo concluída.

## Notas que ainda não existem

Todas as áreas principais têm nota. Para assunto sem nota, a fonte é o código e os arquivos de `docs/` (ex.: [[monitor-notificacoes-expedicao]]). Escreva a nota quando for mexer na área.

## Pendências conhecidas (resolver e apagar daqui)

- **Backup:** nenhuma cópia **externa** do banco confirmada; primeira exportação nunca registrada. Em 24/11/2026 o dono decidiu publicar a GA-019 sem ela (só há cópias dentro do próprio Supabase). Ver [[backup]].
- **Supabase Preview vermelho na `main`:** "Remote migration versions not found in local migrations directory" (anterior à GA-019; versões de migração do banco diferem dos nomes dos arquivos). Não bloqueia o deploy.
- **GA-012 (rascunho, 24/11/2026):** seletor segmentado de plataformas no Dashboard Comercial (estado por escopo, sem vazamento entre contas, resumo GA-018 por conta). Pendência registrada: SQL `commerce_dashboard_overview_v1` devolve Ads da Shopee para qualquer plataforma (não consumido pela interface). Detalhes no [[MAPA-GA]].
- **GA-018 (publicada em 24/11/2026):** Central de Qualidade dos Dados no ar (PR #912, migração `20261124140000` aplicada, versão `20261124144102`). **GA-018A** (refino visual, só interface, PR #914) também publicada em 24/11/2026. Ver `docs/MAPA-GA.md`.
- **GA-020 (proposta, não implementada):** classificação e validação das vendas do Mercado Livre (status, devoluções/reembolsos, receitas derivadas x confirmadas, todas as inconsistências de uma vez). Ver [[ga-019-publicacao]].
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
