# NISTI Identificação Visual

Sistema web da NISTI PRINT para identificar produtos pela arte frontal da capa na expedição.

## Identificação de produtos

A identificação visual automática por câmera foi removida. O sistema mantém o cadastro, o catálogo comercial, a gestão de EAN e as demais operações administrativas sem chamadas a modelos externos.

## Interface

- `/` — painel público; as antigas rotas de identificação visual respondem como recurso removido.
- `/admin` — administração protegida por sessão.
- Administração: Geral, Mockups, Importação, Diagnóstico e Administração do sistema.

## Arquitetura ativa

Frontend:
- `src/entry.jsx`
- `src/public-main.jsx`
- `src/main.jsx`
- `src/app.css`

Worker:
- `src/edge-router.js`
- `src/product-finish-router.js`
- `src/storage-metrics-router.js`
- `src/system-metrics-clean-router.js`
- `src/core-router.js`
- `src/public-image-router.js`
- `src/platform-scope.js`
- `src/sku.js`

## Rollout e Migrações

O Supabase PostgreSQL é a autoridade de leitura e escrita em produção. O D1 não está vinculado ao Worker de produção e permanece somente como camada explícita de compatibilidade/recuperação por meio de `wrangler.d1-compat.toml`.

1. Revisar e aplicar as migrations versionadas do Supabase pelo procedimento operacional correspondente.
2. Usar `npm run db:migrate` somente para manutenção deliberada do banco D1 de compatibilidade.
3. Após o deploy, validar a saúde das leituras e escritas Supabase e os fluxos administrativos ativos.

Consulte `supabase/CUTOVER.md` para o procedimento de cutover e `docs/supabase-cutover-a2-inventory.md` para o estado atual dos caminhos primários e da compatibilidade D1. As validações locais não alteram o banco de produção.

## Stack

- React + Vite
- Cloudflare Workers
- Supabase PostgreSQL (autoridade primária)
- Cloudflare D1 (compatibilidade/recuperação, sem binding em produção)
- Cloudflare R2
- Cloudflare Vectorize
