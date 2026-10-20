// Diagnóstico read-only do anúncio. Identificar queda não equivale a identificar sua causa.
// Não inferir visitas, CTR, conversão, estoque, preço ou concorrência a partir de vendas.
const numeric = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  ? Number(value) : null;

export function buildListingDiagnosis(item, days = 30) {
  const listing = item || {};
  const ready = listing.ready === true;
  const completeVariations = ready && listing.variation_data_complete === true;
  const units = ready ? numeric(listing.units) : null;
  const linked = numeric(days === 0 ? listing.month_linked_units : listing.identified_units);
  const linkedUnits = listing.source === 'SHOPEE' && linked !== null && linked > 0 ? linked : null;
  const growth = days > 0 && listing.source === 'SHOPEE'
    ? numeric(listing.identified_growth_pct) : null;
  const trend = growth !== null && ['FALLING', 'RISING', 'STABLE'].includes(listing.identified_trend)
    ? listing.identified_trend : null;
  const zeroVariations = completeVariations ? numeric(listing.zero_variations) : null;
  const title = String(listing.title || '').trim().replace(/\s+/g, ' ');
  const titleWeak = title.length > 0 && (title.length < 25 || title.split(' ').length < 4);
  const signals = [];

  if (!ready) signals.push({
    id: 'coverage', tone: 'warning', label: 'Vínculo de vendas incompleto',
    evidence: linkedUnits !== null
      ? 'Há ' + linkedUnits + ' unidade(s) identificada(s), mas não há atribuição completa das vendas ao anúncio.'
      : 'Não foi possível confirmar o total de vendas deste anúncio. Falta de vínculo não significa zero.'
  });
  if (trend === 'FALLING') signals.push({
    id: 'fall', tone: 'danger', label: 'Queda nas vendas vinculadas',
    evidence: 'A comparação de períodos equivalentes indica ' +
      new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(growth) +
      '% nas unidades identificadas. A causa da queda ainda não está comprovada.'
  });
  if (ready && units === 0) signals.push({
    id: 'no-sales', tone: 'warning', label: 'Nenhuma venda atribuída no período',
    evidence: 'Com os vínculos atuais completos para este anúncio, não há unidades vendidas na janela consultada.'
  });
  if (zeroVariations !== null && zeroVariations > 0) signals.push({
    id: 'variations', tone: 'warning', label: 'Variações sem vendas',
    evidence: zeroVariations + ' variação(ões) têm zero unidades atribuídas no período. Outras variações podem ter vendido.'
  });
  if (titleWeak) signals.push({
    id: 'title', tone: 'review', label: 'Título potencialmente pouco descritivo',
    evidence: 'O título é curto ou tem poucas palavras. É um critério editorial de revisão, não prova de que o título causou a queda.'
  });
  const checks = [
    { id: 'traffic', title: 'Visitas, impressões e cliques', status: 'Dados não disponíveis',
      detail: 'Compare impressões, CTR e visitas com o período anterior para separar falta de alcance de baixa conversão.',
      action: 'Importar métricas de tráfego da plataforma, com períodos equivalentes.' },
    { id: 'offer', title: 'Preço, frete e prazo', status: 'Verificação necessária',
      detail: 'Não há histórico comparável de preço total, frete e prazo para atribuir a queda à oferta.',
      action: 'Conferir valor total entregue e alterações recentes; não reduzir preço sem avaliar a margem.' },
    { id: 'availability', title: 'Estoque e variações', status: 'Verificação necessária',
      detail: completeVariations && zeroVariations > 0
        ? String(zeroVariations) + ' variação(ões) sem vendas atribuídas; isso não comprova falta de estoque.'
        : 'O relatório de vendas não informa a disponibilidade real das variações.',
      action: 'Verificar disponibilidade, status e possíveis bloqueios no marketplace.' },
    { id: 'creative', title: 'Título, imagem e descrição', status: titleWeak ? 'Revisar título' : 'Verificação necessária',
      detail: titleWeak
        ? 'Título possivelmente genérico. Não há dados de busca ou cliques para confirmar seu impacto.'
        : 'Não há comparação de CTR, indexação ou testes A/B que comprove problema em título ou imagem.',
      action: 'Conferir termos de busca relevantes, atributos, foto principal e descrição sem prometer causalidade.' },
    { id: 'reputation', title: 'Avaliações e concorrência', status: 'Dados não disponíveis',
      detail: 'Sem histórico de reputação e ofertas concorrentes, não é possível medir seu impacto.',
      action: 'Conferir avaliações recentes e comparar anúncios equivalentes.' }
  ];
  const summary = trend === 'FALLING'
    ? { tone: 'danger', title: 'Queda de vendas identificada; causa não confirmada',
      detail: 'Há evidência de retração nas unidades vinculadas. Use as verificações abaixo para investigar o motivo.' }
    : !ready
      ? { tone: 'warning', title: 'Diagnóstico limitado por vínculos incompletos',
        detail: 'O sistema ainda não consegue determinar com segurança o volume total deste anúncio.' }
      : units === 0
        ? { tone: 'warning', title: 'Sem vendas atribuídas; motivo ainda desconhecido',
          detail: 'O próximo passo é separar problemas de alcance, conversão e disponibilidade.' }
        : { tone: 'neutral', title: 'Anúncio com vendas; causa de variações não determinada',
          detail: 'A análise comercial está disponível, mas faltam métricas de tráfego e oferta para concluir motivos.' };
  return {
    summary, signals, checks,
    available: { sales: ready || linkedUnits !== null, trend: trend !== null, variation: completeVariations },
    missing: ['Impressões', 'Cliques/CTR', 'Visitas', 'Taxa de conversão', 'Preço/frete históricos', 'Estoque', 'Avaliações'],
    disclaimer: 'Hipóteses de melhoria não são causas comprovadas. Nenhuma alteração de preço, título ou anúncio é executada automaticamente.'
  };
}
