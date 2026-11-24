// GA-018 — lógica PURA da Central de Qualidade dos Dados (sem React, sem rede): transforma a resposta de
// commerce_data_quality_v1 em cartões. Três dimensões separadas (atualização, cobertura, conciliação); nenhuma nota geral.
export const PLATFORMS=Object.freeze([['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre (Antigo)'],['ML_NOVO','Mercado Livre (Novo)']]);
export const PLATFORM_SHORT=Object.freeze({SHOPEE:'Shopee',ML_ANTIGO:'ML Antigo',ML_NOVO:'ML Novo'});
export const FRESHNESS=Object.freeze({ATUALIZADO:['Atualizado','ok'],DESATUALIZADO:['Desatualizado','warn'],SEM_INFORMACAO:['Sem informação','none']});
export const COVERAGE=Object.freeze({COMPLETA:['Completa','ok'],PARCIAL:['Parcial','warn'],SEM_INFORMACAO:['Sem informação','none']});
export const RECONCILIATION=Object.freeze({CONCILIADO_INTERNAMENTE:['Conciliado internamente','ok'],DIVERGENTE:['Divergente','bad'],SEM_INFORMACAO:['Sem informação','none']});
export const KIND_LABEL=Object.freeze({DESEMPENHO:'Desempenho e tráfego',ADS:'Ads',POS_VENDA:'Pós-venda',TRAFEGO_MANUAL:'Tráfego manual',ADS_ML:'Ads do Mercado Livre'});

const n=v=>v==null?null:Number(v);
export const fmtDate=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:null;};
export const fmtMonth=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})/);return m?m[2]+'/'+m[1]:null;};
const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const money=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const pct=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
const pick=(map,key)=>map[key]||map.SEM_INFORMACAO;
const dim=(label,map,key)=>{const [text,tone]=pick(map,key);return {label,value:text,tone};};

export function isoDate(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
export function presetPeriod(preset,today=new Date()){
  const end=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  const start=new Date(end);
  if(preset==='month')start.setDate(1);
  else start.setDate(start.getDate()-(Number(preset)-1));
  return {start:isoDate(start),end:isoDate(end)};
}
export function validPeriod(start,end){
  const re=/^\d{4}-\d{2}-\d{2}$/;
  if(!re.test(start||'')||!re.test(end||''))return 'Informe as duas datas.';
  if(start>end)return 'A data inicial não pode ser depois da final.';
  const days=(Date.parse(end)-Date.parse(start))/86400000;
  if(days>1100)return 'O período máximo é de 1100 dias.';
  return '';
}

export function salesCard(data){
  const s=data?.sales||{};const rec=s.reconciliation||{};
  const gaps=(s.missing_ranges||[]).map(r=>r.start===r.end?fmtDate(r.start):fmtDate(r.start)+' a '+fmtDate(r.end));
  const actions=[];
  if(s.freshness==='SEM_INFORMACAO')actions.push('Importe o relatório de vendas desta plataforma: não há nenhuma venda registrada.');
  if(s.freshness==='DESATUALIZADO')actions.push('Importe o relatório de vendas mais recente: o último dia registrado é '+fmtDate(s.last_sale_day)+' ('+s.days_behind+' dias atrás).');
  if(n(s.days_without_information)>0)actions.push('Importe o relatório que cubra: '+gaps.join(', ')+'. Dia sem registro é dado ausente, não venda zero.');
  if(n(s.partial_days)>0)actions.push('Há dia parcial (o arquivo foi gerado antes do dia fechar). Reimporte depois que o dia terminar.');
  if(n(s.days_with_records_unverified)>0)actions.push('Há dias com registros cuja completude não dá para verificar (importações antigas). Se importar de novo o período, a verificação passa a existir.');
  if(rec.status==='DIVERGENTE')actions.push('Reimporte o arquivo dos meses divergentes ('+(rec.divergent_months||[]).map(m=>fmtMonth(m.month)).join(', ')+'). Nada é corrigido automaticamente.');
  return {id:'sales',title:'Vendas',lastUpdate:s.last_sale_day||null,
    dims:[dim('Atualização',FRESHNESS,s.freshness),dim('Cobertura',COVERAGE,s.status),dim('Conciliação',RECONCILIATION,rec.status)],
    lines:[
      ['Último dia com venda registrada',fmtDate(s.last_sale_day)||'—'],
      ['Última importação aplicada',s.last_import_at?new Date(s.last_import_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}):'—'],
      ['Dias completos',num(s.complete_days)],['Dias parciais',num(s.partial_days)],
      ['Dias com registros (completude não verificável)',num(s.days_with_records_unverified)],['Dias sem informação',num(s.days_without_information)],
      ['Meses conferidos internamente',rec.months_checked==null?'—':num(rec.months_ok)+' de '+num(rec.months_checked)+' sem diferença']
    ],
    details:gaps.length?['Sem informação em: '+gaps.join(', ')]:[],
    notes:[s.note,'Conciliação = consistência interna entre os arquivos importados; não conferido no marketplace.'].filter(Boolean),actions};
}

export function ordersCard(data){
  const list=data?.sales?.orders||[];
  const verified=list.filter(o=>o.verified&&Number(o.orders)>0);
  const unverified=list.filter(o=>!o.verified);
  const informed=list.filter(o=>o.verified&&Number(o.orders)===0&&Number(o.reported_in_summary)>0);
  const actions=[];
  if(unverified.length)actions.push('Meses sem chave de pedido verificável ('+unverified.map(o=>fmtMonth(o.month)).join(', ')+'): o número é só informado. Reimporte o período com o relatório completo para verificar.');
  if(informed.length)actions.push('Meses com pedidos informados no resumo mas sem pedido verificado ('+informed.map(o=>fmtMonth(o.month)).join(', ')+'): não trate como confirmados.');
  return {id:'orders',title:'Pedidos únicos',lastUpdate:null,
    dims:[{label:'Verificação',value:list.length?(unverified.length||informed.length?'Parcial':'Verificados'):'Sem informação',tone:list.length?(unverified.length||informed.length?'warn':'ok'):'none'}],
    lines:list.map(o=>[fmtMonth(o.month),o.verified?num(o.orders)+' pedido(s) verificado(s) por chave ou resumo diário':'Informado'+(o.reported_in_summary!=null?' ('+num(o.reported_in_summary)+' no resumo)':'')+' · não verificado']),
    details:[],notes:[data?.sales?.orders_note,'Pedidos históricos sem chaves verificáveis aparecem como informados, nunca como verificados.'].filter(Boolean),actions,
    hasData:verified.length>0||list.length>0};
}

export function linkCard(data){
  const g=data?.ga011_shopee;const u=data?.ml_unlinked_sales;
  if(g){
    const gaps=n(g.coverage?.source_missing_days)||0;
    const actions=[];
    if(g.unmatched_sku_count>0)actions.push('Há '+g.unmatched_sku_count+' SKU(s) de venda sem anúncio vinculado. Vincule os SKUs na revisão da Shopee; a conciliação não altera nada.');
    if(gaps>0)actions.push('Importe os '+gaps+' dia(s) ausentes na fonte de SKU da Shopee.');
    return {id:'link',title:'Vendas × anúncios (GA-011)',lastUpdate:null,
      dims:[{label:'Conciliação',value:g.status==='COMPLETO'?'Completa':g.status==='PARCIAL'?'Parcial':'Sem informação',tone:g.status==='COMPLETO'?'ok':g.status==='PARCIAL'?'warn':'none'}],
      lines:[['Receita vinculada a anúncio',pct(g.reconciled_pct?.revenue)],['Unidades vinculadas',pct(g.reconciled_pct?.units)],['SKUs sem vínculo',num(g.unmatched_sku_count)]],
      details:(g.unmatched_skus||[]).map(x=>x.sku_norm+' · '+num(x.units)+' un · '+money(x.revenue)),notes:['Vendas sem vínculo continuam nos totais.'],actions};
  }
  if(u){
    const has=n(u.listings_without_registered_listing)>0;
    return {id:'link',title:'Vendas sem anúncio cadastrado',lastUpdate:null,
      dims:[{label:'Gravidade',value:'Informativo',tone:'info'}],
      lines:[['Anúncios com venda no período',num(u.listings_with_sales)],['Sem anúncio cadastrado',num(u.listings_without_registered_listing)],
        ['Unidades',num(u.units_without_registered_listing)+' ('+pct(u.pct_units)+')'],['Receita',money(u.revenue_without_registered_listing)+' ('+pct(u.pct_revenue)+')'],
        ['Totais do período (incluem essas vendas)',num(u.total_units)+' un · '+money(u.total_revenue)]],
      details:(u.items||[]).map(x=>x.external_listing_id+' · '+num(x.units)+' un · '+money(x.revenue)),
      notes:[u.note],actions:has?['Informativo: confira no Mercado Livre se esses anúncios ainda existem. Não se presume que estejam inativos e nada é alterado ou excluído dos totais.']:[]};
  }
  return null;
}

export function reportCards(data){
  return (data?.reports||[]).map(r=>{
    const none=!r.reports;
    const actions=[];
    if(r.kind==='ADS_ML')actions.push('Não existe fonte de Ads do Mercado Livre. Nenhuma ação possível agora.');
    else if(none)actions.push('Nenhum relatório de '+KIND_LABEL[r.kind]+' importado. Importe um para ter esse indicador.');
    else if(r.freshness==='DESATUALIZADO')actions.push('O relatório mais recente termina em '+fmtDate(r.last_period_end)+' ('+r.days_since_period_end+' dias; limite 30). Exporte e importe um novo.');
    if(r.period_overlaps_requested===false&&!none)actions.push('Nenhum relatório cobre o período escolhido.');
    if(n(r.overlapping_report_pairs)>0)actions.push('Há '+r.overlapping_report_pairs+' par(es) de relatórios com períodos sobrepostos; confira se não há contagem em dobro antes de somar.');
    return {id:'report-'+r.kind,title:KIND_LABEL[r.kind]||r.kind,lastUpdate:r.last_period_end||null,
      dims:[dim('Atualização',FRESHNESS,r.freshness),{label:'Período informado',value:none?'Sem informação':r.period_overlaps_requested?'Cruza o período':'Fora do período',tone:none?'none':r.period_overlaps_requested?'ok':'warn'}],
      lines:none?[]:[['Relatórios',num(r.reports)],['Primeiro período',fmtDate(r.first_period_start)||'—'],['Último período termina em',fmtDate(r.last_period_end)||'—'],
        ['Importado por último em',r.last_imported_at?fmtDate(r.last_imported_at):'—'],['Pares sobrepostos',num(r.overlapping_report_pairs)]],
      details:[],notes:[r.note||'Período do relatório não é cobertura diária comprovada.'],actions};
  });
}

export function catalogCard(data){
  const c=data?.catalog||{};const actions=[];
  if(c.freshness==='SEM_INFORMACAO')actions.push('O catálogo desta plataforma nunca foi verificado ou está vazio.');
  if(c.freshness==='DESATUALIZADO')actions.push('A última verificação foi há '+c.days_since_last_check+' dias (limite 7). Atualize o catálogo.');
  if(n(c.listings_never_checked)>0)actions.push(c.listings_never_checked+' anúncio(s) nunca foram verificados.');
  return {id:'catalog',title:'Catálogo de anúncios',lastUpdate:c.last_checked_at||null,
    dims:[dim('Atualização',FRESHNESS,c.freshness)],
    lines:[['Anúncios cadastrados',num(c.listings)],['Última verificação',c.last_checked_at?fmtDate(c.last_checked_at):'—'],['Nunca verificados',num(c.listings_never_checked)]],
    details:[],notes:['O cadastro tem só anúncios ativos.'],actions};
}

export function priceStockCard(data){
  const p=data?.price_stock||{};const reg=p.registered_price||{};const rea=p.realized_price||{};const stk=p.stock||{};
  const label=s=>s==='DISPONIVEL'?'Disponível':s==='DISPONIVEL_FOTO'?'Disponível (foto do catálogo)':'Sem informação';
  const actions=[];
  if(reg.status==='SEM_INFORMACAO')actions.push('Preço cadastrado e estoque não existem para esta plataforma; não há ação possível nesta versão.');
  return {id:'price-stock',title:'Preço e estoque',lastUpdate:reg.snapshot_last_checked_at||null,
    dims:[{label:'Preço cadastrado',value:label(reg.status),tone:reg.status==='SEM_INFORMACAO'?'none':'info'},{label:'Preço realizado',value:label(rea.status),tone:rea.status==='SEM_INFORMACAO'?'none':'ok'},{label:'Estoque',value:label(stk.status),tone:stk.status==='SEM_INFORMACAO'?'none':'info'}],
    lines:[['Variações com preço cadastrado',reg.status==='SEM_INFORMACAO'?'—':num(reg.variations_with_price)+' de '+num(reg.variations)],
      ['Anúncios com preço realizado no período',num(rea.listings_with_units)],['Variações com estoque na foto',stk.status==='SEM_INFORMACAO'?'—':num(stk.variations_with_stock)]],
    details:[],notes:[reg.note,rea.note,stk.note].filter(Boolean),actions};
}

export function batchesCard(data){
  const b=data?.open_batches||[];
  return {id:'batches',title:'Importações abertas',lastUpdate:null,
    dims:[{label:'Situação',value:b.length?b.length+' aberta(s)':'Nenhuma',tone:b.length?'warn':'ok'}],
    lines:b.map(x=>[x.file,'lote '+x.batch_id+' · '+num(x.rows)+' linhas · '+(x.status==='STAGED'?'lida, não aplicada':x.status)]),
    details:[],notes:[],
    actions:b.length?['Estes arquivos foram lidos e não aplicados. Aplique ou descarte pela tela de importações; esta tela não altera nada.']:[]};
}

export function buildCards(data){
  if(!data)return [];
  return [salesCard(data),ordersCard(data),linkCard(data),...reportCards(data),catalogCard(data),priceStockCard(data),batchesCard(data)].filter(Boolean);
}
