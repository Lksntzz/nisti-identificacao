export const ADMIN_MENU_SECTIONS = Object.freeze([
  {
    title: 'CADASTRO',
    items: Object.freeze([
      { id: 'catalogo', label: 'Produtos NISTI', icon: 'grid' },
      { id: 'mural-nisti', label: 'Mural NISTI', icon: 'mural' },
      { id: 'gerador-barras', label: 'Gerador de Barras', icon: 'barcode' }
    ])
  },
  {
    title: 'COMERCIAL',
    items: Object.freeze([
      { id: 'commerce', label: 'Catálogo Comercial', icon: 'grid', href: '/admin-commerce' }
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
