export const ADMIN_MENU_SECTIONS = Object.freeze([
  {
    title: 'CADASTRO',
    items: Object.freeze([
      { id: 'catalogo', label: 'Produtos NISTI', icon: 'grid' },
      {
        id: 'mural-nisti',
        label: 'Mural NISTI',
        icon: 'mural',
        children: Object.freeze([
          { id: 'dashboard', label: 'Painel' },
          { id: 'publish', label: 'Publicar' },
          { id: 'treatment', label: 'Tratamento' }
        ])
      },
      { id: 'gerador-barras', label: 'Gerador de Barras', icon: 'barcode' }
    ])
  },
  {
    title: 'COMERCIAL',
    items: Object.freeze([
      {
        id: 'commerce',
        label: 'Catálogo',
        icon: 'grid',
        children: Object.freeze([
          { id: 'catalog', label: 'Catálogo' },
          { id: 'sales', label: 'Vendas' },
          { id: 'import-center', label: 'Central de Importações' },
          { id: 'pending', label: 'Pendências' }
        ])
      }
    ])
  },
  {
    title: 'BIPAGENS',
    items: Object.freeze([
      { id: 'historico-ean', label: 'Histórico de Bipagens', icon: 'history' },
      { id: 'ean-nao-cadastrados', label: 'EAN não Cadastrados', icon: 'alert' }
    ])
  },
  {
    title: 'SISTEMA',
    items: Object.freeze([
      { id: 'logs', label: 'Saúde & Logs', icon: 'terminal' }
    ])
  }
]);

export const REMOVED_ADMIN_NAV_IDS = Object.freeze([
  'identificacao',
  'similares',
  'cadastrar',
  'importar',
  'plataformas',
  'configuracoes',
  'usuarios',
  'historico',
  'nao-identificados',
  'shadow-observability',
  'verificar',
  'gtins'
]);
