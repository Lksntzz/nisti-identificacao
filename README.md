# NISTI PRINT · Catálogo Comercial

Aplicação administrativa para gestão de Produtos Mestre e anúncios comerciais.

## Escopo atual

O sistema mantém somente três áreas operacionais:

- Gestão
- Produtos Mestre
- Anúncios

O backend usa Supabase PostgreSQL como fonte de dados. O Worker Cloudflare cuida da autenticação administrativa, proteção das APIs e entrega do frontend.

## Desenvolvimento

```bash
npm ci
npm test
npm run build
npm run dev
```

## Produção

O deploy oficial usa o workflow `Deploy Production` no GitHub Actions e o Worker `nisti-identificacao`.

O sistema legado de reconhecimento visual, Gemini, Vectorize, scanner/GTIN, D1 operacional, R2 de imagens e observabilidade de reconhecimento foi removido do runtime.
