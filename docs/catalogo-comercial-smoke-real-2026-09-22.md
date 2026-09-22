# Catálogo Comercial — preflight com planilhas reais (2026-09-22)

Este documento registra a validação estrutural feita com cópias reais fornecidas pela operação antes do primeiro commit do catálogo comercial.

## Arquivos analisados

| Plataforma | Arquivo | SHA-256 | Tamanho |
|---|---|---|---:|
| Shopee | `Cópia de ATUAL SHOPEE.xlsx` | `699c17530dc62341c1d722b61119caefa267571dbe18722528cd18fd1e5025e4` | 105.733 bytes |
| Mercado Livre | `Cópia de ATUAL MERCADO LIVRE(1).xlsx` | `efabc6c089ef3d2f4098a5f19e7cb190df9b30486ba3617ab636dba77062c2f4` | 82.168 bytes |

Nenhum dos arquivos foi versionado no repositório.

## Resultado do parser/normalizador

### Shopee

- 8 abas reconhecidas;
- 286 linhas de produto;
- 286 links de anúncio;
- 286 linhas classificadas como `READY`;
- 0 linhas `REVIEW`;
- 0 linhas `INVALID`;
- 0 SKUs duplicados entre linhas;
- 4 URLs compartilhadas por mais de um SKU, confirmando relação N:N anúncio ↔ produto.

A Shopee é a melhor candidata para o primeiro onboarding porque fornece a base mais limpa para criar os produtos mestre.

### Mercado Livre

- 8 abas reconhecidas;
- 278 linhas de produto;
- 243 hyperlinks externos no workbook;
- 205 células exibem a URL diretamente;
- 38 células exibem apenas texto/título e guardam a URL real como hyperlink do Excel;
- 35 linhas não têm link de anúncio;
- 36 linhas trazem sinal de origem equivalente a `NOT_LISTED`;
- 1 dessas 36 linhas também possui URL válida, portanto é uma inconsistência de origem e deve ser tratada como `REVIEW`, não como ausência de anúncio;
- após essa regra: 242 linhas `READY` e 36 linhas `REVIEW`;
- 3 SKUs aparecem em mais de uma linha, totalizando 6 linhas afetadas por conflito de SKU duplicado;
- 5 URLs são compartilhadas por mais de uma linha/SKU.

## Previsão de reconciliação Mercado Livre após onboarding da Shopee

Simulação usando as regras atuais de SKU oficial/alias, nome normalizado, categoria e nome sem ano:

| Resultado previsto | Linhas |
|---|---:|
| Match exato | 224 |
| Correspondência provável | 39 |
| Produto novo | 9 |
| Conflito por SKU duplicado | 6 |
| Total | 278 |

Os 6 conflitos por SKU duplicado permanecem bloqueados para decisão humana. A reconciliação v3 gera candidatos para essas linhas, evitando o estado anterior em que o operador só poderia ignorá-las.

## Casos de borda confirmados

1. Hyperlink do Mercado Livre pode estar embutido na célula enquanto o texto visível é apenas o título do anúncio. O importador usa o destino do hyperlink e preserva o texto original para auditoria.
2. URLs com `pdp_filters=item_id%3AMLB...` são decodificadas antes de extrair o ID vendedor. `/p/MLB...` e `MLBU...` não são tratados como ID vendedor quando não existe `item_id`.
3. `N Cadastrado` sem URL significa produto conhecido sem anúncio naquela plataforma; não cria listing fictício.
4. `N Cadastrado` com URL é dado contraditório. A URL é preservada como evidência de listing e o estado efetivo vira `REVIEW`.
5. Mesmo anúncio pode conter mais de um SKU/produto; URL não é identidade de produto.
6. SKU duplicado em linhas distintas não é resolvido automaticamente.
7. O ADM permite confirmar/criar produto `NOT_LISTED` mesmo sem URL; a ausência do anúncio é parte do estado comercial, não uma falha de validação.

## Smoke transacional do Supabase

Foram executados testes com `ROLLBACK`, sem dados de teste persistidos:

- produto `NOT_LISTED` é commitado como produto mestre com `matched_listing_id = null` e zero listings criados;
- conflito de SKU duplicado permanece `CONFLICT`, mas a reconciliação v3 gera candidatos para todas as linhas afetadas no cenário de teste.

Após os smoke tests, as tabelas comerciais de produtos, listings e importações permanecem vazias; o primeiro onboarding real ainda não foi commitado.

## Critério para o primeiro onboarding

1. importar Shopee;
2. revisar/confirmar criação dos produtos mestre;
3. commit da Shopee;
4. importar Mercado Livre;
5. resolver `PROBABLE`, produtos realmente novos e os 6 conflitos de SKU duplicado;
6. validar amostra de produtos/listings;
7. somente então abrir a primeira campanha anual 2027.

O merge/deploy da V1 continua bloqueado até smoke test pelo navegador e validação visual do ADM.
