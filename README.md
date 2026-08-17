# NISTI Identificação

Sistema web para identificação visual de produtos da expedição.

## V1
- ADM cadastra produtos e imagem frontal
- Parser de SKU no padrão `MIOLO_CAPA_ACABAMENTO`
- Expedição tira foto pelo celular
- Gemini analisa capa e acabamentos
- Backend valida a combinação no banco
- Resultado exibe SKU, Wire-O, tassel, elástico e plataforma

## Stack
- React + Vite
- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2
- Gemini API
