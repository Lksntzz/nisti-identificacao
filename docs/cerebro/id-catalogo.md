# ID / Scanner e catálogo de produtos (NISTI ID)

O coração do sistema: o operador lê o código de barras (EAN-13) de um caderno e o sistema mostra qual produto é, para expedir sem erro. O mesmo cadastro de produtos alimenta o Mural e o GA.

## O que faz

- **Scanner (NISTI PRINT):** abre a câmera, lê o EAN-13 e mostra SKU, nome, variação, acabamento (wire-o, tassel, elástico), imagem e links por plataforma.
- **Cadastro de produto:** cria ou atualiza um produto a partir do SKU; pode já vincular um EAN.
- **Vínculo EAN ↔ produto:** adicionar e desativar EANs de um produto.
- **Gerador de código de barras:** gera EAN-13 em SVG/PNG e em lote por coleção (`src/scanner/ean-barcode.js`, `src/scanner/ean-collections.js`).
- **Catálogo (admin):** lista de produtos, etiquetas por plataforma, exportação em planilha.
- **Registro de leituras:** cada leitura vira um evento (identificado, não cadastrado, erro do sistema) para o admin ver o que o scanner está encontrando.

## Caminho de um dado

- **Ler um EAN:** `GtinScannerOverlay` (`src/scanner/gtin-scanner-overlay.jsx`) → `GET /api/gtin/<ean>` → `lookupProductByGtin` (`src/scanner/gtin-router.js`) → leitura no Supabase. Cada leitura grava um evento em segundo plano, sem atrasar a resposta.
- **Vincular EAN:** `POST /api/products/<id>/gtins` → `bindGtinToProduct` → função SQL `nisti_bind_product_gtin_primary_v1`. Depois dispara o rascunho automático do Mural (ver [[mural]]).
- **Cadastrar produto:** `POST /api/products` (`src/core/core-router.js`, `upsertCatalogProduct`) → `nisti_upsert_product_primary_v1` → sincroniza com o GA (`src/nisti-commerce-sync.js`).
- **Acabamento:** `PATCH /api/products/<id>/finish` (`src/imagens/product-finish-router.js`) → `nisti_finish_product_primary_v1`.
- A leitura da câmera usa `BarcodeDetector` do navegador quando existe; senão cai no decodificador próprio (`src/scanner/gtin-camera-decoder.js`).

## Regras de negócio

- **SKU tem formato fixo `MIOLO_CAPA_ACABAMENTO`** (`src/core/sku.js`). O acabamento tem 3 letras: wire-o (P preto, B branco, R rose gold), tassel e elástico (cores, ou `X` = sem). Fora desse formato o cadastro é recusado.
- **EAN precisa ser EAN-13 com dígito verificador correto** (`src/scanner/gtin.js`); senão erro 400.
- **Um EAN ativo pertence a um produto só.** Vincular um EAN que já é de outro produto dá erro 409 (`gtin_conflict`). Apagar um vínculo é só desativar (`active=false`); o registro fica. Se o EAN pode ser religado a outro produto depois depende da função SQL `nisti_bind_product_gtin_primary_v1`, que não conferi (no caminho D1 antigo podia).
- **Fonte do EAN:** `GS1` (oficial) ou `NISTI` (gerado por nós); qualquer outro valor vira `NISTI`.
- **Não duplicar produto.** O mesmo produto com dois códigos (ex.: `...BXB` e `...BB`, que só difere na referência do tassel) não deve existir duas vezes. Unificações já feitas ficam registradas no fim do [[MAPA-GA]].
- **Cache do scanner no aparelho** (`src/scanner/gtin-scan-cache.js`): só vale se o servidor estiver INACESSÍVEL (sem rede, timeout, 5xx, 408 ou 429) e por até 12 h. Resposta definitiva (404 não cadastrado, 400) nunca usa o cache, para não mostrar um produto que foi desvinculado. Quando usa, avisa que os dados não foram confirmados.
- **Imagem do produto:** o Mural só usa a versão tratada se ela veio da imagem atual do produto (detalhes em [[mural]]).

## Armadilhas

- **A consulta do scanner (`/api/gtin/...`) não pede login.** Ficam protegidas só `/api/admin/*`, `/api/products*` e `/api/sku/*` (`isProtectedApi` em `src/edge-router.js`). Quem tem o link consegue consultar um EAN. Decisão que o dono deve conhecer antes de colocar dado sensível na resposta do scanner.
- **O nome do operador é só identificação, não autenticação** (comentário em `eventOperator`: "Sem PIN"). Vem do aparelho (`nisti_operator_name`) e pode ser qualquer texto.
- **Cadastrar ou mudar produto mexe no GA:** toda gravação dispara a sincronização com o Painel Comercial. O código usa a versão "Safe" da sincronização, então uma falha provavelmente não desfaz o cadastro (não testei): o produto fica salvo e o GA pode ficar sem ele (há rota de reparo em `/api/admin/commerce-sync/nisti-products/<id>/repair`).
- **Código antigo em D1 ainda existe** em `src/scanner/gtin-router.js` como alternativa. Produção usa Supabase como banco principal (ver [[supabase-cutover-a2-inventory]]); não mexa no caminho D1 achando que roda.
- **Cada leitura grava um evento.** Mudar o scanner para consultar com mais frequência aumenta gravações e pode esbarrar no limite de requisições (ver [[limites-requisicoes]]).
- `src/scanner/gtin-scanner.css` é muito grande; mudanças de estilo ali afetam o scanner inteiro.

## Cuidados ao mexer

- Função SQL nova: `_v1`, revogar de `public, anon, authenticated`, conceder a `service_role` (ver [[deploy]]).
- Mexeu em SKU, EAN ou no cadastro? Rodar `npm test` (há testes de SKU, GTIN, vínculo, cache e cadastro) e conferir também o GA, que recebe esses produtos.
- Não mudar o dígito verificador nem o formato do SKU sem plano para os produtos já cadastrados e para os códigos impressos nos cadernos.
- Testar o scanner em celular real: a câmera se comporta diferente por aparelho.

## Arquivos principais

- `src/scanner/gtin-router.js`: consulta, vínculo, desvínculo e eventos de leitura.
- `src/core/core-router.js`: cadastro e exclusão de produto, sincronização com o GA.
- `src/imagens/product-finish-router.js`: acabamento.
- `src/scanner/gtin.js`, `src/core/sku.js`, `src/scanner/gtin-product-normalizer.js`: regras de EAN e SKU.
- `src/scanner/gtin-scanner-overlay.jsx`, `src/scanner/gtin-camera-decoder.js`, `src/scanner/gtin-scan-cache.js`: tela, leitura e cache do scanner.
- `src/scanner/ean-barcode.js`, `src/scanner/ean-collections.js`, `src/scanner/BarcodeGeneratorView.jsx`: gerador de código de barras.
- `src/admin/CatalogView.jsx`, `src/admin/ProductRegistrationModal.jsx`, `src/admin/catalog-xlsx.js`: catálogo e cadastro no admin.
- `src/nisti-commerce-sync.js`: envio do produto ao GA.
