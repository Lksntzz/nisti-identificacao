# Auditoria de Segurança — NISTI ID

Data: 2026-10-07  
Escopo: frontend, Cloudflare Worker, APIs, Supabase, R2, Canva, Web Push, Service Worker, uploads, dependências e CI/CD.

## Modelo de confiança

O navegador é considerado não confiável. Tudo que pode ser alterado via DevTools, localStorage, JavaScript, headers ou chamadas manuais deve ser validado ou substituído no servidor.

A autoridade de dados permanece no Supabase por credenciais server-side. Segredos não são enviados ao navegador.

## Correções aplicadas

- Removido acesso direto do navegador às Edge Functions de leitura do Supabase.
- Identidade de operador passou a ser emitida e assinada no Worker, em cookie HttpOnly/Secure/SameSite=Strict.
- Headers `x-user-id` enviados pelo cliente são sobrescritos pelo Worker.
- APIs administrativas continuam exigindo sessão administrativa assinada.
- Mutações cross-site são recusadas por Origin/Sec-Fetch-Site.
- CSP restringe scripts a `self` e bloqueia conexão direta do navegador ao Supabase.
- Adicionados HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP e CORP.
- Cache do painel administrativo é `no-store/private`.
- Uploads de imagens validam tamanho, MIME permitido e assinatura binária real.
- Downloads server-side do Canva aceitam apenas URLs oficiais autorizadas.
- Links de edição/visualização do Canva são filtrados para a origem web oficial.
- Web Push rejeita endpoints não HTTPS, credenciais embutidas, localhost, loopback e redes privadas.
- Service Worker não navega notificações para origens externas.
- `allowedHosts: all` foi removido do servidor Vite.
- JavaScript inline necessário ao Modo PC foi externalizado para permitir CSP mais estrita.
- `/api/health` não revela mais topologia de banco ou bindings internos.
- Edge Functions diretas antigas foram alteradas para fail-closed e serão desativadas na implantação coordenada.
- GitHub Actions foram fixadas por SHA imutável.
- Dependabot foi habilitado para npm e GitHub Actions.
- Wrangler foi atualizado para 4.148.0 e o lockfile foi regenerado.
- O CI bloqueia vulnerabilidades de severidade alta em dependências de runtime e na árvore completa.

## Supabase

Auditoria do projeto de produção confirmou:

- sem grants de tabela para `anon`, `authenticated` ou `PUBLIC` no schema público;
- RPCs operacionais restritas ao `service_role`;
- políticas públicas permissivas não foram encontradas;
- RLS permanece ativo onde configurado.

## Segredos

Busca no repositório não encontrou chaves privadas, tokens de serviço ou arquivos de segredo versionados.

Os seguintes tipos de segredo permanecem no ambiente do Worker, não no frontend:

- senha administrativa;
- chave de serviço do Supabase;
- credenciais OAuth do Canva;
- chave de criptografia dos tokens Canva;
- chave privada VAPID.

## Limites do navegador

Não é possível impedir o usuário de abrir o Chrome DevTools ou modificar o JavaScript local. A proteção correta é não confiar no navegador.

Após este hardening, modificar localStorage, inventar `x-user-id`, alterar o JavaScript ou chamar APIs administrativas manualmente não concede autoridade administrativa sem uma sessão válida assinada no servidor.

## Pendências de infraestrutura

- Configurar rate limiting no perímetro Cloudflare para o login administrativo e rotas de maior custo.
- Criar um `ADMIN_SESSION_SECRET` dedicado após o deploy da versão segura do Worker.
- Desativar/deployar fail-closed as duas Edge Functions diretas antigas do Supabase após o frontend/Worker seguro estar ativo.
- Considerar tornar o repositório GitHub privado e proteger a branch `main` com regras obrigatórias de PR/CI. O repositório não contém segredos detectados, mas atualmente a arquitetura fica publicamente visível.

## Critério de publicação

A alteração de segurança só deve chegar à produção quando:

1. auditoria de dependências passar;
2. migrations locais passarem;
3. suíte completa de testes passar;
4. build de produção passar;
5. Worker for publicado com sucesso;
6. Edge Functions legadas forem fechadas;
7. smoke tests confirmarem login, API administrativa e fluxo do operador.
