# NISTI Identificação Visual

Sistema web da NISTI PRINT para identificar produtos pela arte frontal da capa na expedição.

## Regra de identificação

- A foto da expedição considera somente a arte-base da capa.
- Wire-O, tassel, elástico, miolo, plataforma e personalização textual não são usados para reconhecer visualmente a capa.
- O sistema nunca inventa SKU.
- O fluxo usa `gemini-embedding-2` para busca visual e `gemini-3.5-flash-lite` como verificador quando necessário.
- Se uma mesma capa pertencer a mais de um SKU, o usuário escolhe entre os produtos cadastrados.
- O retrieval principal aceita múltiplas referências visuais por `capa_code` e agrupa as correspondências por capa antes da verificação local.

## Interface

- `/` — identificação pela câmera do celular.
- `/admin` — administração protegida por sessão.
- Administração: Geral, Mockups, Importação, Diagnóstico e Administração do sistema.

## Arquitetura ativa

Frontend:
- `src/entry.jsx`
- `src/public-main.jsx`
- `src/main.jsx`
- `src/app.css`

Worker:
- `src/vectorize-performance-router.js`
- `src/vectorize-candidates.js`
- `src/structural-final-v8.js`
- `src/edge-router.js`
- `src/product-finish-router.js`
- `src/reference-reindex-router.js`
- `src/vectorize-admin-router.js`
- `src/storage-metrics-router.js`
- `src/system-metrics-clean-router.js`
- `src/core-router.js`
- `src/public-image-router.js`
- `src/platform-scope.js`
- `src/recognition-metrics.js`
- `src/gemini-budget.js`
- `src/sku.js`

## Referências visuais

A partir da migration `0005_cover_visual_references.sql`, a mesma arte-base pode possuir várias referências oficiais. Cada referência recebe um embedding independente e um vetor por plataforma no Vectorize. A consulta retorna referências semelhantes da plataforma selecionada, agrupa por `capa_code` e envia as candidatas mais relevantes para a verificação comparativa multimodal via Gemini.

Referências adicionais podem representar condições reais como foto frontal, perspectiva, personalização e condição difícil. Elas não criam novos produtos nem SKUs; apenas aumentam a cobertura visual da capa existente.

## Rollout e Migrações

1. Validar as migrations localmente: `npx wrangler d1 migrations apply nisti-identificacao --local`.
2. Aplicar a migration no D1 remoto: `npm run db:migrate`.
3. Após o deploy, executar `/api/admin/reindex-cover-embeddings` até `pending_references = 0`.
4. Executar `/api/admin/vectorize-sync` até todas as referências estarem sincronizadas.
5. Validar `/api/admin/vectorize-status` e `/api/admin/cover-index`.

O Production Gate executa a migration completa contra um D1 local antes do build. Isso valida a sintaxe e a sequência das migrations sem alterar o banco de produção.

## Stack

- React + Vite
- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- Cloudflare Vectorize
- Google Gemini API (`gemini-embedding-2` + `gemini-3.5-flash-lite`)
