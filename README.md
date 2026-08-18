# NISTI Identificação Visual

Sistema web da NISTI PRINT para identificar produtos pela arte frontal da capa na expedição.

## Regra de identificação

- A foto da expedição considera somente a arte-base da capa.
- Wire-O, tassel, elástico, miolo, plataforma e personalização textual não são usados para reconhecer visualmente a capa.
- O sistema nunca inventa SKU.
- O fluxo usa `gemini-embedding-2` para busca visual e `gemini-3.5-flash-lite` como verificador quando necessário.
- Se uma mesma capa pertencer a mais de um SKU, o usuário escolhe entre os produtos cadastrados.

## Interface

- `/` — identificação pela câmera do celular.
- `/admin` — administração protegida por sessão.
- Administração: Geral, Mockups, Importação e Administração do sistema.

## Arquitetura ativa

Frontend:
- `src/main.jsx`
- `src/app.css`

Worker:
- `src/performance-router.js`
- `src/edge-router.js`
- `src/fast-identify-v3.js`
- `src/product-finish-router.js`
- `src/storage-metrics-router.js`
- `src/system-metrics-clean-router.js`
- `src/core-router.js`
- `src/sku.js`

## Stack

- React + Vite
- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- Gemini API
