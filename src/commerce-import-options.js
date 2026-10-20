// One registry powers the import dropdown and the universal upload screen.
export const COMMERCE_IMPORT_OPTIONS=Object.freeze([
  {mode:'catalog',label:'Produtos e anúncios',description:'Catálogo de anúncios ativos por plataforma',icon:'package',fileType:'Planilha de produtos / anúncios'},
  {mode:'sales',label:'Vendas',description:'Pedidos e faturamento por plataforma',icon:'chart-no-axes-column-increasing',fileType:'Relatório de vendas / pedidos'},
  {mode:'ads',label:'Shopee Ads',description:'Tráfego e desempenho de publicidade CPC',icon:'megaphone',fileType:'Relatório de anúncios CPC'},
  {mode:'aftercare',label:'Pós-venda Shopee',description:'Devoluções e reembolsos vinculados por SKU',icon:'refresh-cw',fileType:'Relatório de devoluções / reembolsos'}
]);
