// One registry powers the import dropdown and the universal upload screen.
export const COMMERCE_IMPORT_OPTIONS=Object.freeze([
  {mode:'catalog',label:'Produtos e anúncios',description:'Catálogo de anúncios ativos por plataforma',icon:'package',fileType:'Planilha de produtos / anúncios'},
  {mode:'sales',label:'Vendas',description:'Pedidos e faturamento por plataforma',icon:'chart-no-axes-column-increasing',fileType:'Relatório de vendas / pedidos'},
  {mode:'ads',label:'Shopee Ads',description:'Tráfego e desempenho de publicidade CPC',icon:'megaphone',fileType:'Relatório de anúncios CPC'},
  {mode:'performance',label:'Desempenho Shopee',description:'Impressões, cliques e pedidos por anúncio',icon:'trending-up',fileType:'Relatório de desempenho por produto'},
  {mode:'ml_performance',label:'Desempenho Mercado Livre',description:'Visitas, vendas e conversão por anúncio',icon:'trending-up',fileType:'Relatório de desempenho das publicações'},
  {mode:'aftercare',label:'Pós-venda Shopee',description:'Devoluções e reembolsos vinculados por SKU',icon:'refresh-cw',fileType:'Relatório de devoluções / reembolsos'}
]);
