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
- `src/main.jsx`
- `src/app.css`
- `src/local-vision.js`
- `src/local-vision-v3.js`
- `src/personalized-vision.js`

Worker:
- `src/vectorize-performance-router.js`
- `src/vectorize-candidates.js`
- `src/structural-fallback-v3.js`
- `src/performance-router.js`
- `src/edge-router.js`
- `src/product-finish-router.js`
- `src/vectorize-admin-router.js`
- `src/storage-metrics-router.js`
- `src/system-metrics-clean-router.js`
- `src/core-router.js`
- `src/recognition-metrics.js`
- `src/sku.js`

## Referências visuais

A partir da migration `0005_cover_visual_references.sql`, a mesma arte-base pode possuir várias referências oficiais. Cada referência recebe um embedding independente e um vetor `ref:<REFERENCE_ID>` no Vectorize. A consulta retorna referências semelhantes, agrupa por `capa_code` e envia um conjunto pequeno e diverso ao verificador local.

Referências adicionais podem representar condições reais como foto frontal, perspectiva, personalização e condição difícil. Elas não criam novos produtos nem SKUs; apenas aumentam a cobertura visual da capa existente.

## Rollout da migration 0005

1. Validar as migrations localmente: `npx wrangler d1 migrations apply nisti-identificacao --local`.
2. Aplicar a migration no D1 remoto antes de publicar o Worker novo: `npx wrangler d1 migrations apply nisti-identificacao --remote`.
3. Depois do deploy, executar `/api/admin/reindex-cover-embeddings` até `pending_references = 0`.
4. Executar `/api/admin/vectorize-sync` até todas as referências estarem sincronizadas.
5. Validar `/api/admin/vectorize-status` e `/api/admin/cover-index`.
6. Fazer smoke/regressão com capas conhecidas, visualmente parecidas e imagens negativas antes de considerar a mudança estável.

## Stack

- React + Vite
- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- Cloudflare Vectorize
- Gemini API
- JSFeat ORB/RANSAC
