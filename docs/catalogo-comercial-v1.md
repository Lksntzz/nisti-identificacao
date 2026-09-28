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

O módulo comercial não faz dual-write para D1 e não altera `products`/`product_platforms` do reconhecimento.

## Navegação do ADM

O menu administrativo possui uma seção **COMERCIAL** apontando para `/admin-commerce`.

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

`commerce_marketplaces` contém as plataformas. A V1 inicia com Shopee, Mercado Livre e Amazon.

`commerce_listings` representa o anúncio na plataforma e `commerce_listing_products` implementa a relação N:N entre anúncio e produto. Isso suporta tanto um produto publicado em várias plataformas quanto anúncios com várias variações/produtos.

A URL não é identidade de produto. O ID externo do anúncio é armazenado quando disponível.

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
leitura e normalização no navegador
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

### Hyperlinks embutidos

A planilha real do Mercado Livre contém células cujo texto visível é apenas o título do anúncio, enquanto a URL real está armazenada como hyperlink OOXML. O importador recupera o destino real para normalização e preserva o texto originalmente visível para auditoria.

O leitor distingue:

- hyperlinks existentes no workbook;
- hyperlinks efetivamente recuperados porque o texto visível não era uma URL.

### Produtos sem anúncio (`NOT_LISTED`)

`N Cadastrado`/`NOT_LISTED` sem URL significa evidência de produto, não anúncio quebrado. O produto pode existir no catálogo mestre sem que o sistema crie listing ou URL sintética naquela plataforma.

Se a linha diz `NOT_LISTED`, mas também contém uma URL válida, o dado é contraditório:

- a URL é preservada como evidência de anúncio;
- o sinal original é preservado em `source_update_hint`;
- o estado efetivo passa para `REVIEW`;
- a linha exige revisão antes do commit.

## Reconciliação

A reconciliação segue esta precedência:

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
- produto novo exige aprovação explícita;
- SKU duplicado dentro do mesmo arquivo permanece conflito;
- correspondência aproximada nunca cria vínculo automaticamente;
- o commit é bloqueado enquanto existirem pendências obrigatórias.

Para conflitos de SKU duplicado, a reconciliação v3 mantém o estado `CONFLICT`, mas gera candidatos de produtos existentes para que o administrador consiga decidir qual vínculo é correto no ADM.

As decisões humanas possíveis são:

- confirmar um produto existente;
- criar como novo produto;
- ignorar a linha.

Produtos explicitamente sem anúncio também podem ser confirmados/criados sem fabricar uma URL.

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

Linhas `NOT_LISTED` podem criar/vincular o produto mestre com `matched_listing_id = null`. As demais linhas criam ou atualizam listings reais. Anúncios iguais podem receber múltiplos produtos, desde que a identidade do anúncio seja consistente.

## Primeiro onboarding

Com base nas cópias reais analisadas, a ordem definida é:

1. importar Shopee;
2. revisar/aprovar produtos mestre;
3. commit da Shopee;
4. importar Mercado Livre;
5. resolver correspondências prováveis, produtos realmente novos e conflitos de SKU duplicado;
6. validar uma amostra do catálogo;
7. somente então abrir a campanha anual 2027.

A Shopee é usada primeiro porque a cópia analisada é estruturalmente mais consistente e não apresentou SKU duplicado entre linhas.

## Atualização anual

`commerce_update_campaigns`, `commerce_update_items` e `commerce_update_checks` suportam campanhas como 2026 → 2027.

Cada item pode controlar separadamente:

- SKU;
- título;
- descrição;
- imagens;
- vídeo;
- atributos.

Produtos `PERMANENT` não entram automaticamente na virada anual.

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
- parser `.xlsx` browser-side versionado;
- recuperação de hyperlinks embutidos no Excel;
- staging de importação em lotes;
- normalização Shopee/Mercado Livre;
- reconciliação determinística e candidatos prováveis;
- candidatos para conflitos de SKU duplicado;
- decisões de revisão inclusive para produto sem anúncio;
- aprovação em lote de produtos novos;
- commit transacional do catálogo;
- operações da campanha anual na interface;
- testes e smoke tests transacionais no Supabase.

## Critérios de liberação da V1

A V1 só deve sair do Draft quando:

- Production Gate estiver verde no head final;
- smoke test no navegador com cópias reais de Shopee e Mercado Livre estiver concluído;
- contagens do staging forem comparadas com as planilhas reais;
- conflitos críticos estiverem visíveis e resolvíveis no ADM;
- amostra de produtos/listings após primeiro onboarding for validada;
- campanha 2027 for revisada com dados reais importados;
- não houver alteração regressiva no pipeline de identificação visual.
