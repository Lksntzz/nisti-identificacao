import React from 'react';
import { commerceFormatNumber } from './commerce-admin-shared.jsx';

export default function CommerceUpdateView({ dashboard }) {
  return (
    <section className="commerce-panel">
      <div className="commerce-panel-header">
        <div>
          <h2>Atualização Anual</h2>
          <p>Controle granular para a virada 2026 → 2027 por anúncio e produto.</p>
        </div>
      </div>
      <div className="commerce-update-example">
        <div><span>SKU</span><strong>Não verificado</strong></div>
        <div><span>Título</span><strong>Não verificado</strong></div>
        <div><span>Descrição</span><strong>Não verificado</strong></div>
        <div><span>Imagens</span><strong>Não verificado</strong></div>
        <div><span>Vídeo</span><strong>Não verificado</strong></div>
      </div>
      <div className="commerce-notice">
        <strong>{commerceFormatNumber(dashboard?.update_items_pending || 0)} itens pendentes atualmente.</strong>
        <p>Produtos permanentes ficam fora da campanha anual por padrão. O status final só será concluído quando todas as verificações obrigatórias estiverem em OK ou Não aplicável.</p>
      </div>
    </section>
  );
}
