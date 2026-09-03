export const ADMIN_MENU_SECTIONS = Object.freeze([
  {
    title: 'CATÁLOGO',
    items: Object.freeze([
      { id: 'catalogo', label: 'Catálogo de Produtos', icon: 'grid' }
    ])
  },
  {
    title: 'OPERAÇÃO',
    items: Object.freeze([
      { id: 'usuarios', label: 'Ocorrências & Operadores', icon: 'users' },
      { id: 'historico', label: 'Histórico de Identificações', icon: 'history' },
      { id: 'nao-identificados', label: 'Falhas de Identificação', icon: 'alert' }
    ])
  },
  {
    title: 'IA & QUALIDADE',
    items: Object.freeze([
      { id: 'shadow-observability', label: 'Observabilidade IA', icon: 'brain' },
      { id: 'verificar', label: 'Testar Reconhecimento', icon: 'shield-check' }
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
  'configuracoes'
]);
