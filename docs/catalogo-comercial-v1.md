# NISTI PRINT — Catálogo Comercial V1

## Objetivo

Centralizar produtos, anúncios e controles comerciais de marketplaces no painel administrativo existente, substituindo as planilhas Excel como fonte de verdade sem remover a capacidade de importar/exportar Excel.

## Arquitetura

- **Painel administrativo existente:** ponto de entrada para o módulo.
- **Cloudflare Worker:** autenticação e API administrativa.
- **Supabase PostgreSQL:** fonte de verdade exclusiva do Catálogo Comercial.
- **D1:** permanece autoridade do pipeline atual de identificação visual até eventual cutover independente.
- **R2:** arquivos e imagens quando necessário.
- **Vectorize:** continua restrito à busca visual.

O módulo comercial não faz dual-write para D1.

## Navegação do ADM

O menu administrativo passa a possuir uma seção **COMERCIAL** apontando para `/admin-commerce`.

A área comercial contém:

1. Visão Geral;
2. Produtos Mestre;
3. Anúncios;
4. Importações Excel;
5. Atualização Anual.

A rota `/admin-commerce` reutiliza a mesma sessão administrativa de `/admin`.

## Modelo de domínio

### Produto mestre

`commerce_products` representa a identidade comercial da NISTI. O identificador interno é imutável e não depende de marketplace, URL ou ano no SKU.

SKUs ficam em `commerce_product_skus`, permitindo:

- SKU atual;
- SKU histórico;
- aliases;
- uma única referência `CURRENT` ativa por produto.

### Marketplace e anúncio

`commerce_marketplaces` contém as plataformas. A V1 inicia com:

- Shopee;
- Mercado Livre;
- Amazon.

`commerce_listings` representa o anúncio na plataforma.

`commerce_listing_products` implementa a relação N:N entre anúncio e produto. Isso suporta tanto um produto publicado em várias plataformas quanto anúncios com várias variações/produtos.

A URL não é a identidade do produto. O ID externo do anúncio é armazenado quando disponível.

## Estado comercial

Status do anúncio e situação comercial são separados:

- anúncio: `UNKNOWN`, `ACTIVE`, `PAUSED`, `INACTIVE`, `REMOVED`;
- venda: `UNKNOWN`, `SELLING`, `NO_SALES`.

A V1 não inventa automaticamente o estado ativo/vendendo quando a fonte Excel não comprova isso.

## Importação de Excel

O fluxo é fail-closed:

```text
XLSX
  ↓
normalização no navegador
  ↓
commerce_import_batches / commerce_import_rows
  ↓
reconciliação
  ↓
revisão humana quando necessário
  ↓
commit transacional
  ↓
catálogo definitivo
```

O payload original de cada linha é preservado junto da versão normalizada.

A normalização possui perfis próprios para Shopee e para as diferentes abas do Mercado Livre porque as planilhas reais não usam um layout único.

## Reconciliação

A reconciliação implementada segue esta precedência:

1. SKU oficial/alias exato;
2. SKU já usado em marketplace;
3. nome normalizado + categoria;
4. nome normalizado;
5. nome sem ano, para detectar mudanças como 2025 → 2026;
6. sem candidato → produto novo.

Regras de segurança:

- um único SKU exato pode ser vinculado automaticamente;
- mais de um produto compatível por SKU vira `CONFLICT`;
- correspondência por nome vira `PROBABLE` e exige decisão humana;
- produto novo começa como `NO_MATCH` e exige aprovação explícita, inclusive na aprovação em lote do primeiro onboarding;
- SKU duplicado dentro do mesmo arquivo vira conflito;
- linha sem URL válida do anúncio não pode ser commitada;
- o commit é bloqueado enquanto existirem `PENDING`, `PROBABLE`, `CONFLICT` ou `INVALID`.

As decisões humanas possíveis são:

- confirmar um produto existente;
- criar como novo produto;
- ignorar a linha.

## Commit da importação

O commit é executado dentro de uma função PostgreSQL e falha integralmente quando detecta inconsistência estrutural.

Para produtos novos:

- cria categoria quando necessário;
- cria `commerce_products` como `DRAFT`;
- cria SKU `CURRENT`;
- preserva SKU secundário como alias quando aplicável.

Para produtos existentes:

- adiciona aliases somente se não pertencerem a outro produto;
- conflito de propriedade de SKU aborta a transação.

Anúncios iguais podem receber múltiplos produtos, desde que a identidade do anúncio seja consistente.

## Atualização anual

`commerce_update_campaigns`, `commerce_update_items` e `commerce_update_checks` suportam campanhas como 2026 → 2027.

Cada item pode controlar separadamente:

- SKU;
- título;
- descrição;
- imagens;
- vídeo;
- atributos.

Produtos `PERMANENT` não precisam entrar automaticamente na virada anual.

## Segurança

As tabelas comerciais possuem RLS habilitado e não são acessíveis diretamente por `anon` ou `authenticated`.

As RPCs administrativas são executáveis somente por `service_role` e são chamadas server-side pelo Worker. A service-role key nunca é enviada ao navegador.

A API fica em `/api/admin/commerce/*` e passa pelo guard da sessão administrativa existente.

## Estado atual da implementação

Implementado:

- schema `commerce_*` no Supabase;
- índices e foreign keys;
- dashboard, produtos e anúncios paginados;
- módulo visual `/admin-commerce`;
- staging de importação;
- normalização Shopee/Mercado Livre;
- reconciliação automática/determinística;
- candidatos prováveis para revisão humana;
- decisões de revisão;
- aprovação em lote de produtos novos;
- commit transacional do catálogo;
- listagem de lotes de importação;
- testes e smoke test transacional no Supabase.

Pendente antes de liberar a V1 em produção:

- integrar um parser `.xlsx` browser-side versionado e reprodutível;
- ligar o seletor de arquivo à normalização/staging;
- finalizar a tela de revisão de importações;
- implementar as operações da campanha 2027 na interface;
- smoke test ponta a ponta com cópias reais das planilhas;
- merge/deploy somente após Production Gate verde e critérios de aceite.
