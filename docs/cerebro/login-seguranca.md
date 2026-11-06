# Login e segurança

Quem pode entrar onde, como as sessões funcionam e o que protege o sistema. Tudo roda no Worker (`src/edge-router.js`); o navegador nunca é tratado como confiável.

## Quem entra e como (4 tipos de acesso)

| Acesso | Como prova quem é | Onde |
|---|---|---|
| **Admin** | Senha única (segredo `ADMIN_PASSWORD` no Cloudflare) em `/admin-login`; vira cookie `nisti_admin_session` | `/admin`, `/api/admin/*`, `/api/products*`, `/api/sku/*` |
| **Operador** (scanner, Mural) | Sem senha. Cada aparelho ganha um cookie assinado `nisti_operator_session` com id `op_<uuid>` | resto de `/api/*` |
| **Equipe de expedição** | Link privado `/convite-expedicao/<chave>`; guarda cookie `__Host-nisti_dispatch_sender` por 30 dias | só `/api/dispatch/*` |
| **Monitor de notificações** | Página sem dados; as operações exigem o cookie acima | `/monitor-notificacoes`, `/painel-expedicao` |

## Como funciona (pelo código)

- **Não existem contas de usuário.** Há uma senha de administrador compartilhada. Todo "quem fez" do admin é a mesma pessoa para o sistema.
- **Sessão do admin:** cookie assinado (HMAC-SHA256), vale 12 h, `HttpOnly; Secure; SameSite=Strict`. Não há tabela de sessões: o servidor só confere a assinatura e a validade.
- **Chave de assinatura:** `ADMIN_PASSWORD`, somada a `ADMIN_SESSION_SECRET` quando este existir. Sem `ADMIN_PASSWORD` configurado, o admin fica bloqueado (e o login avisa isso).
- **Sessão do operador:** assinada com a mesma chave; só identifica o aparelho (notificações e histórico). O Worker **sobrescreve** o cabeçalho `x-user-id` e apaga `x-operator-verified`, então o navegador não consegue se passar por outro operador.
- **Link da expedição:** o servidor guarda só o SHA-256 da chave (`DISPATCH_SENDER_TOKEN_SHA256`). A permissão não herda a sessão do admin e é uma lista fechada: ver fila, opções, enviar lote e conectar.
- **Login:** só o `POST` em `/admin-login` conta como tentativa. Tem token CSRF em cookie próprio (`__Host-nisti_login_csrf`), atraso de 275 ms na falha e limite de 10 tentativas por minuto por IP. Em produção, se o limitador não existir, o login responde 503 em vez de ficar sem limite.
- **Mutações nas APIs** (POST/PUT/PATCH/DELETE) exigem mesma origem (`Origin` e `Sec-Fetch-Site`); cross-site é recusado com 403.
- **Cabeçalhos:** HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP/CORP e Permissions-Policy (só a câmera liberada, para o scanner). Nas páginas HTML há CSP com `script-src 'self'` (sem script inline) e `connect-src` só para o próprio site e o Canva.
- **Rate limit por IP** (limites no `wrangler.toml`): geral, login, monitor da expedição e criação de arte no Canva. Detalhes e a lista de telas que consultam sem parar em [[limites-requisicoes]].
- **Congelamento de escrita:** `SUPABASE_CUTOVER_WRITE_FREEZE=1` faz toda escrita de API responder 503 (`src/operator-audit-router.js`). Valor diferente de 0 e 1 também bloqueia, de propósito.
- **Banco:** o navegador nunca fala com o Supabase; só o Worker, com a chave de serviço (segredo do Worker). As funções SQL são liberadas só ao `service_role`. Ver [[deploy]] para a regra de função nova.

## Armadilhas

- **Sair não invalida o cookie.** O logout só apaga o cookie do navegador. Um cookie copiado continua válido até vencer (12 h). O jeito de derrubar todas as sessões é trocar `ADMIN_PASSWORD` (ou `ADMIN_SESSION_SECRET`), já que a assinatura depende deles. Pelo código, não testei.
- **Trocar a senha também derruba as sessões de operador**, porque a mesma chave as assina; cada aparelho ganha uma sessão nova sozinho.
- **Consulta de EAN do scanner é pública** (`/api/gtin/<ean>` não está em `isProtectedApi`). Ver [[id-catalogo]].
- **Operador sem PIN:** o nome digitado no aparelho é só identificação.
- **`ADMIN_SESSION_SECRET` dedicado** foi uma pendência da auditoria de 07/10/2026. Não consigo ver segredos do Cloudflare daqui, então **não sei se já foi criado**. Se faltar, a chave é só a senha. Conferir no painel da Cloudflare (Workers → o Worker → Settings → Variables and Secrets).
- **Rota `/admin-commerce` responde 404 de propósito** neste Worker (`edge-router.js`). Não conferi por que; antes de mexer, ler o código ao redor.
- **Mural:** o host `mural.` só serve o Mural; outras rotas devolvem 404 (ver [[mural]]).
- **Repositório público:** ver o código não dá acesso, mas qualquer segredo commitado vira público. Regra do `CLAUDE.md`: nada de chaves, senhas ou dados de negócio em arquivos.
- **Branch `main` sem proteção no GitHub.** O deploy só publica commits vindos de PR com o teste verde, mas quem tem permissão de escrita ainda pode alterar a `main`. Passo a passo em [[PLANO-PROTECAO-E-RECUPERACAO]].

## Cuidados ao mexer

- Não colocar dado sensível em rota que não esteja em `isProtectedApi` (ela decide o que exige login).
- Rota nova do admin: usar o prefixo `/api/admin/` para herdar a proteção.
- Cookie novo: `HttpOnly; Secure; SameSite=Strict`, como os existentes.
- Nunca digitar nem pedir senhas; trocar a senha do admin é com o Lucas, no painel da Cloudflare.
- Mexeu em cabeçalho/CSP? Testar scanner (câmera), Mural e admin no navegador: CSP mais estrita quebra tela em silêncio.
- Auditoria de referência: [[SECURITY_AUDIT_2026-10-07]] (retrato daquela data, não atualizar).

## Arquivos principais

- `src/edge-router.js`: login, sessões, CSRF, rate limit, cabeçalhos, `isProtectedApi`.
- `src/operator-audit-router.js`: congelamento de escrita e registro de atividade do admin.
- `src/expedition-dispatch-sender-router.js`: link privado da expedição.
- `wrangler.toml`: limites de requisição e variáveis (nunca segredos).
