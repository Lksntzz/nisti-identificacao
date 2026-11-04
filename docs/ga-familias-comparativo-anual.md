# GA — Famílias e edições (v1)

## Objetivo

Comparar o desempenho anual de produtos que compartilham **modelo/miolo, formato físico e categoria**, mesmo quando têm capas, SKUs, edições e anúncios diferentes. O agrupamento não altera os Produtos Mestre existentes nem apaga suas identidades.

Exemplo: `Agenda diária · A5` é uma família. A edição 2026 com capa floral e a edição 2027 com capa minimalista continuam com Produtos Mestre, SKUs e anúncios próprios.

## Entrada no sistema

No GA: `Comparação anual > Famílias e edições`.

- **Analisar vendas:** escolher ano, marketplace, família (ou visão geral) e unidade/receita. **Sem selecionar família, os indicadores e os 12 meses incluem todas as vendas importadas, mesmo que nenhuma família esteja cadastrada.** Ver evolução mensal, ranking, mês de destaque e detalhes por SKU/anúncio. Ao escolher uma família, a consulta limita os indicadores aos seus membros confirmados e permite selecionar `Ano inteiro` ou um mês específico para comparar **o mesmo mês nos dois anos** por capa, edição, SKU e anúncio.
- **Gerenciar famílias:** cadastrar nome, modelo, formato e categoria. Buscar Produtos Mestre por nome ou SKU. Conferir modelo e formato, escrever justificativa e marcar confirmação para vincular.
- Vínculos não são inferidos automaticamente por nome, SKU ou imagem. Uma capa diferente não impede pertencer à mesma família; um modelo ou formato diferente impede.
- Reclassificação exige desvincular com justificativa e, em seguida, vincular à família correta. O log registra os eventos.

## Fonte e semântica

- Fonte: `commerce_current_sales_listing_daily_v1` (lotes de vendas importados e válidos).
- O **ano da venda** vem de `sale_date` e determina a coluna 2025/2026. O **ano da edição** vem de `commerce_products.edition_year` e é apenas uma característica do Produto Mestre.
- O SKU da venda é associado ao Produto Mestre somente quando sua chave canônica tem proprietário único **na vigência declarada para o ano da venda**. SKU ausente, ambíguo ou potencialmente anacrônico não entra em nenhuma família.
- Um produto de edição anual 2027 não recebe venda de 2025 só porque o código possui um alias histórico. As vendas não atribuídas permanecem contadas como **sem família**, nunca fabricadas como zero. O relatório separa unidades sem Produto Mestre identificável das unidades com Produto Mestre ainda não vinculado à família.
- `MERCADO_LIVRE` soma `ML_ANTIGO` e `ML_NOVO`, mas preserva a conta real no detalhamento.
- A comparação do ano atual usa o último dia de venda disponível no ano selecionado, cortando o ano-base na data equivalente. Não chama mês futuro de zero. `TODAS` pode combinar fontes com coberturas diferentes, por isso a tela mostra aviso e datas com registros por conta/ano.
- Datas inicial/final de registros não são garantia de importação completa. Validar os lotes antes de decisões de estoque, coleção ou precificação.

## Banco de dados e liberação

As migrations devem ser aplicadas **na ordem**:

1. `supabase/migrations/20261104150000_commerce_annual_product_families_v1.sql`: tabelas, índices, RLS e RPCs do cadastro e auditoria.
2. `supabase/migrations/20261104151000_commerce_annual_family_report_v1.sql`: RPC somente leitura do relatório.
3. `supabase/migrations/20261104162000_commerce_annual_family_overview_v2.sql`: a mesma RPC passa a devolver `overall_months` com o comparativo geral independente das classificações. `months` permanece restrito a famílias confirmadas.

Não executar em produção sem janela de alteração e validação específica. As novas tabelas não recebem preenchimento automático. A aplicação anterior permanece funcional se a mudança ficar apenas na branch; se a interface for publicada antes das migrations, o menu novo retornará erro de função indisponível.

Todos os endpoints ficam atrás do guard de administração existente; as RPCs e tabelas novas são acessíveis apenas pelo `service_role` no servidor. Não usar chave privilegiada no navegador.

## Validação e aceite

1. Aplicar migrations em ambiente de homologação e conferir grants/RLS e plano da consulta por período.
2. Cadastrar uma família real; vincular duas capas do mesmo modelo/formato, com SKUs diferentes, após conferência manual.
3. Selecionar ano e marketplace em que há vendas e confrontar as unidades/receita com as linhas de importação do GA.
4. Conferir ano da edição, SKU e ID de anúncio no detalhamento e seguir os links para os anúncios.
5. Validar cenário com SKU duplicado/alias e ano-base não importado. Esses registros não devem produzir atribuições nem variações artificiais.
6. Verificar telas em desktop e celular, modo escuro, sem regressões nos comparativos anuais existentes.

## Próxima evolução sugerida

Depois de algumas famílias revisadas e de confirmar a qualidade do histórico: filtros de categoria/subcategoria, exportação CSV, cobertura completa por lote e análise de lançamentos de edições vs. mesmo mês do ano anterior. Não construir previsão de vendas até haver cobertura histórica suficiente.
