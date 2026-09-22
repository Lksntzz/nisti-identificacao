# NISTI PRINT — Catálogo Comercial V1

## Objetivo

Centralizar produtos, anúncios e controles comerciais de marketplaces no painel administrativo existente, substituindo as planilhas Excel como fonte de verdade sem remover a capacidade de importar/exportar Excel.

## Decisões arquiteturais

- O painel administrativo atual continua sendo a interface única de administração.
- O novo módulo fica isolado do catálogo operacional de reconhecimento visual.
- `public.products` e `public.product_platforms` existentes não serão alteradas por este módulo.
- O Catálogo Comercial usa tabelas próprias com prefixo `commerce_` no Supabase PostgreSQL.
- Cloudflare Worker continua sendo a fronteira de API/autenticação; o navegador não recebe `SUPABASE_SERVICE_ROLE_KEY`.
- R2 continua responsável por imagens/arquivos grandes. PostgreSQL guarda somente dados estruturados e referências de arquivo.
- D1 continua autoridade do pipeline atual de reconhecimento até o cutover D1 → Supabase já documentado no projeto.
- Não haverá dual-write do Catálogo Comercial entre D1 e Supabase.

## Navegação proposta no ADM

### CATÁLOGO
- Catálogo de Produtos
- Códigos EAN
- Gerador de Barras

### COMERCIAL
- Visão Geral
- Produtos Mestre
- Anúncios
- Atualização Anual
- Importações
- Reconciliação

### OPERAÇÃO
- Histórico de Leituras
- EAN não Cadastrados

### SISTEMA
- Saúde & Logs

## Modelo conceitual

```text
commerce_products
  ├── commerce_product_skus
  ├── commerce_listing_products ── commerce_listings ── commerce_marketplaces
  └── commerce_update_items ── commerce_update_checks

commerce_categories
  └── commerce_subcategories

commerce_import_batches
  └── commerce_import_rows
      └── commerce_reconciliation_candidates

commerce_update_campaigns
  └── commerce_update_items
      └── commerce_update_checks
```

## Regras centrais

### Produto Mestre

`commerce_products` representa a identidade comercial interna do produto. O ID não muda quando SKU, ano ou marketplace mudam.

Os códigos ficam em `commerce_product_skus`. Cada produto pode ter SKUs `CURRENT`, `HISTORICAL` e `ALIAS`, mas somente um SKU `CURRENT` ativo. O banco impede que o mesmo SKU normalizado pertença simultaneamente a produtos diferentes.

### Produto anual vs. permanente

`temporal_type`:

- `ANNUAL`: exige `edition_year` e participa de campanhas anuais.
- `PERMANENT`: não entra automaticamente em viradas de ano.
- `UNCLASSIFIED`: estado temporário para dados ainda não classificados.

### Anúncio não é produto

`commerce_listings` representa o anúncio na plataforma. Um anúncio pode conter vários produtos/variações, e um produto pode estar em vários anúncios/plataformas. A relação N:N é mantida em `commerce_listing_products`.

Quando for conhecido, `product_sku_id` liga a variação do anúncio a uma versão específica do SKU interno. `platform_sku` preserva o código usado pelo marketplace quando ele divergir do código interno.

### Exclusividade

“Exclusivo Shopee”, “Exclusivo Mercado Livre” e “Multiplataforma” são informações derivadas dos anúncios vinculados. Não serão campos editáveis.

### Ativo e vendendo

São estados independentes:

- `listing_status`: `UNKNOWN`, `ACTIVE`, `PAUSED`, `INACTIVE`, `REMOVED`.
- `sales_status`: `UNKNOWN`, `SELLING`, `NO_SALES`.

Enquanto não houver API oficial da plataforma, os estados podem permanecer `UNKNOWN` ou ser revisados manualmente.

### Vídeo

`video_status`: `UNKNOWN`, `ACTIVE`, `ABSENT`, `DISABLED`.

Isso evita valores ambíguos das planilhas como `sim/desa`.

## Importação Excel

Fluxo obrigatório:

```text
Excel
  → commerce_import_batches
  → commerce_import_rows (bruto)
  → normalização
  → matching
  → reconciliação
  → catálogo definitivo
```

A importação nunca grava diretamente em `commerce_products` sem passar pela etapa de reconciliação.

### Estados de linha importada

- `PENDING`
- `MATCHED`
- `PROBABLE`
- `NEW_PRODUCT`
- `CONFLICT`
- `INVALID`
- `IGNORED`
- `COMMITTED`

### Matching

Ordem recomendada:

1. SKU `CURRENT` exato;
2. SKU `HISTORICAL`/`ALIAS`;
3. `platform_sku` já conhecido;
4. nome normalizado + categoria;
5. correspondência provável;
6. revisão humana.

Correspondência aproximada nunca cria vínculo automaticamente quando houver ambiguidade.

## Atualização anual

Uma campanha como `Atualização 2027` é criada em `commerce_update_campaigns`.

Cada relação produto/anúncio entra em `commerce_update_items` por meio de `listing_product_id` e recebe verificações em `commerce_update_checks`.

Tipos iniciais de verificação:

- `SKU`
- `TITLE`
- `DESCRIPTION`
- `IMAGES`
- `VIDEO`
- `ATTRIBUTES`

Estados:

- `NOT_CHECKED`
- `OK`
- `NEEDS_UPDATE`
- `IN_PROGRESS`
- `BLOCKED`
- `NOT_APPLICABLE`

Cada verificação também informa `is_required`. O anúncio só é considerado atualizado quando todas as verificações obrigatórias estiverem `OK` ou `NOT_APPLICABLE`.

## Segurança

- tabelas `commerce_*` não serão acessadas diretamente pelo navegador;
- RLS fica habilitado;
- `anon` e `authenticated` não recebem acesso direto;
- o Worker usa a service-role key somente no servidor;
- rotas comerciais ficam sob a autenticação administrativa existente;
- importação mantém o payload bruto para auditoria e rastreabilidade.

## Escopo da V1

Incluído:

- catálogo mestre;
- categorias/subcategorias;
- histórico/aliases de SKU;
- anúncios por marketplace;
- vínculo N:N produto ↔ anúncio;
- importação Excel auditável;
- reconciliação;
- campanha anual;
- filtros/paginação;
- cálculo de exclusividade/multiplataforma.

Fora da V1:

- alteração automática de anúncios em Shopee/Mercado Livre;
- captura automática de vendas;
- edição automática de imagens 2026 → 2027;
- integração direta com APIs de marketplaces.

## Estratégia de entrega

1. Schema Supabase e validações.
2. API administrativa no Worker.
3. telas base no ADM.
4. importador Excel Shopee/Mercado Livre.
5. reconciliação.
6. atualização anual 2027.
7. métricas e critérios de aceite.

Nenhuma etapa deve modificar o pipeline de reconhecimento visual existente.