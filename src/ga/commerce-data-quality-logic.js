// GA-018 — lógica PURA da Central de Qualidade dos Dados (sem React, sem rede): transforma a resposta de
// commerce_data_quality_v1 em cartões. Três dimensões separadas (atualização, cobertura, conciliação); nenhuma nota geral.
import {maskMoney} from './commerce-privacy.js';
export const PLATFORMS=Object.freeze([['SHOPEE','Shopee'],['ML_ANTIGO','Mercado Livre (Antigo)'],['ML_NOVO','Mercado Livre (Novo)']]);
export const PLATFORM_SHORT=Object.freeze({SHOPEE:'Shopee',ML_ANTIGO:'ML Antigo',ML_NOVO:'ML Novo'});
export const FRESHNESS=Object.freeze({ATUALIZADO:['Atualizado','ok'],PARCIALMENTE_DESATUALIZADO:['Parcialmente desatualizado','warn'],DESATUALIZADO:['Desatualizado','warn'],SEM_INFORMACAO:['Sem informação','none']});
export const COVERAGE=Object.freeze({COMPLETA:['Completa','ok'],PARCIAL:['Parcial','warn'],SEM_INFORMACAO:['Sem informação','none']});
export const RECONCILIATION=Object.freeze({CONCILIADO_INTERNAMENTE:['Conciliado internamente','ok'],DIVERGENTE:['Divergente','bad'],SEM_INFORMACAO:['Sem informação','none']});
export const KIND_LABEL=Object.freeze({DESEMPENHO:'Desempenho e tráfego',ADS:'Ads',POS_VENDA:'Pós-venda',TRAFEGO_MANUAL:'Tráfego manual',ADS_ML:'Ads do Mercado Livre'});

const n=v=>v==null?null:Number(v);
export const fmtDate=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:null;};
export const fmtMonth=v=>{const m=String(v||'').match(/^(\d{4})-(\d{2})/);return m?m[2]+'/'+m[1]:null;};
const num=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const money=v=>maskMoney(v==null?'—':Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));
const pct=v=>v==null?'—':Number(v).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
const pick=(map,key)=>map[key]||map.SEM_INFORMACAO;
const dim=(label,map,key)=>{const [text,tone]=pick(map,key);return {label,value:text,tone};};

// Resultado só vale para o pedido que o gerou: evita mostrar cartões do período anterior como se fossem do novo.
export const requestKey=(platform,start,end,detail)=>[platform,start,end,detail?1:0].join('|');
export const isCurrentResult=(result,key)=>Boolean(result&&result.key===key&&result.data);
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
    notes:[s.note,'Conciliação = consistência interna entre os arquivos importados; não conferido no marketplace.',(data?.sales?.months_scope_note)||'Conciliação usa meses inteiros, mesmo que o período cubra só parte do mês.'].filter(Boolean),actions};
}

export function ordersCard(data){
  const list=data?.sales?.orders||[];
  const label=o=>{
    const cov=(o.coverage==='PARCIAL'?' · cobertura parcial: '+num(o.days_with_data)+' de '+num(o.days_expected)+' dias com dado':'')
      +(o.includes_partial_day?' · inclui '+num(o.days_partial)+' dia(s) parcial(is) (ainda abertos ou arquivo gerado no mesmo dia)':'');
    const keyPart=' · '+num(o.days_by_key)+' de '+num(o.days_with_data)+' dia(s) com dado por chave ('+pct(o.key_coverage_pct)+')';
    if(o.basis==='SEM_INFORMACAO'||o.orders==null)return 'Sem informação (nenhum dia com dado no mês)';
    if(o.basis==='CHAVE')return num(o.orders)+' pedido(s) contados por dia, a partir de chaves de pedido'+keyPart+cov;
    if(o.basis==='RESUMO_HISTORICO')return num(o.orders)+' informado(s) em resumo histórico · não verificado por chave'+cov;
    return num(o.orders)+' · base mista'+keyPart+' · não verificado por completo'+cov;
  };
  const noInfo=list.filter(o=>o.basis==='SEM_INFORMACAO'||o.orders==null);
  const summary=list.filter(o=>o.basis==='RESUMO_HISTORICO'||o.basis==='MISTO');
  const partial=list.filter(o=>o.coverage==='PARCIAL'&&o.basis!=='SEM_INFORMACAO');
  const openDay=list.filter(o=>o.includes_partial_day);
  const allKey=list.length>0&&list.every(o=>o.verified_by_key&&o.coverage==='COMPLETA');
  const m=arr=>arr.map(o=>fmtMonth(o.month)).join(', ');
  const actions=[];
  if(summary.length)actions.push('Meses com número vindo de resumo histórico ('+m(summary)+'): estão informados, não verificados por chave. Só reimporte o período se tiver o relatório completo daquele intervalo.');
  if(noInfo.length)actions.push('Meses sem informação de pedidos ('+m(noInfo)+'): não há dia importado; nada a corrigir sem um relatório desse mês.');
  if(partial.length)actions.push('Meses com cobertura parcial ('+m(partial)+'): o total de pedidos cobre só parte dos dias do mês.');
  if(openDay.length)actions.push('Meses com dia parcial ('+m(openDay)+'): a cobertura por chave não significa dia completo; o dia atual ou um arquivo gerado no mesmo dia pode mudar.');
  return {id:'orders',title:'Pedidos únicos (meses inteiros)',lastUpdate:null,
    dims:[{label:'Verificação',value:!list.length?'Sem informação':allKey?'Por chave':'Parcial ou informado',tone:!list.length?'none':allKey?'ok':'warn'}],
    lines:list.map(o=>[fmtMonth(o.month),label(o)]),
    brief:list.map(o=>[fmtMonth(o.month),o.orders==null?'Sem informação':num(o.orders)+' · '+(o.basis==='CHAVE'?'por chave':o.basis==='RESUMO_HISTORICO'?'resumo histórico':'base mista')+(o.coverage==='PARCIAL'?' · parcial':'')]),
    details:[],notes:['Contagem por DIA (regra da GA-019): pedido que aparece em dois dias conta duas vezes.',data?.sales?.months_scope_note||'Pedidos mensais usam meses inteiros, mesmo que o filtro cubra só parte do mês.'],actions};
}

export function linkCard(data){
  const g=data?.ga011_shopee;const u=data?.ml_unlinked_sales;
  if(g){
    const gaps=n(g.coverage?.source_missing_days)||0;
    const unexplained=g.reconciliation_status==='DIVERGENTE';
    const actions=[];
    if(unexplained)actions.push('Há diferença sem explicação entre a fonte de SKU e a base de anúncios (resíduo de '+num(g.residual_units)+' un e '+money(g.residual_revenue)+'). Não considere conciliado: confira SKUs e dias antes de usar os números.');
    if(g.unmatched_sku_count>0)actions.push('Há '+g.unmatched_sku_count+' SKU(s) de venda sem anúncio vinculado. Vincule os SKUs na revisão da Shopee; a conciliação não altera nada.');
    if(gaps>0)actions.push('Importe os '+gaps+' dia(s) ausentes na fonte de SKU da Shopee.');
    const cov=g.coverage_status;
    return {id:'link',title:'Vendas × anúncios (GA-011)',lastUpdate:null,
      dims:[{label:'Cobertura de registros',value:cov==='COMPLETO'?'Completa':cov==='PARCIAL'?'Parcial':'Sem informação',tone:cov==='COMPLETO'?'ok':cov==='PARCIAL'?'warn':'none'},
        dim('Conciliação',RECONCILIATION,g.reconciliation_status)],
      lines:[['Receita vinculada a anúncio',pct(g.reconciled_pct?.revenue)],['Unidades vinculadas',pct(g.reconciled_pct?.units)],['SKUs sem vínculo',num(g.unmatched_sku_count)],
        ['Diferença explicada',g.explained==null?'—':g.explained?'Sim':'Não'],['Resíduo (unidades)',num(g.residual_units)],['Resíduo (receita)',money(g.residual_revenue)]],
      details:(g.unmatched_skus||[]).map(x=>x.sku_norm+' · '+num(x.units)+' un · '+money(x.revenue)),
      notes:['Cobertura completa significa que os registros existem, não que não há divergência. Vendas sem vínculo continuam nos totais.'],actions};
  }
  if(u&&u.severity==='SEM_INFORMACAO')return {id:'link',title:'Vendas sem anúncio cadastrado',lastUpdate:null,
    dims:[{label:'Situação',value:'Sem informação',tone:'none'}],lines:[],details:[],notes:[u.note],actions:['Nenhuma venda registrada neste período; escolha outro período ou importe o relatório de vendas.']};
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
  if(c.freshness==='SEM_INFORMACAO')actions.push('Nenhum anúncio desta plataforma tem data de verificação: não dá para dizer se o catálogo está atualizado.');
  if(n(c.not_fresh_listings)>0&&c.freshness!=='SEM_INFORMACAO')actions.push(num(c.not_fresh_listings)+' de '+num(c.listings)+' anúncio(s) ('+pct(c.not_fresh_pct)+') sem verificação nos últimos 7 dias; o mais antigo foi verificado há '+c.days_since_oldest_check+' dias. Atualize o catálogo.');
  if(n(c.never_checked_listings)>0&&c.freshness!=='SEM_INFORMACAO')actions.push(num(c.never_checked_listings)+' anúncio(s) nunca foram verificados.');
  return {id:'catalog',title:'Catálogo de anúncios',lastUpdate:c.last_checked_at||null,
    dims:[dim('Atualização',FRESHNESS,c.freshness)],
    lines:[['Anúncios no catálogo do GA',num(c.listings)],['Verificados nos últimos 7 dias',num(c.fresh_listings)],
      ['Desatualizados (verificação > 7 dias)',num(c.stale_listings)],['Nunca verificados',num(c.never_checked_listings)],
      ['Sem verificação recente (total)',n(c.listings)?num(c.not_fresh_listings)+' ('+pct(c.not_fresh_pct)+')':'—'],
      ['Verificação mais recente',c.last_checked_at?fmtDate(c.last_checked_at):'—'],['Verificação mais antiga',c.oldest_checked_at?fmtDate(c.oldest_checked_at):'—']],
    details:[],notes:[c.note||'A data mais recente não prova que o catálogo inteiro está atualizado.'],actions};
}

export function priceStockCard(data){
  const p=data?.price_stock||{};const reg=p.registered_price||{};const rea=p.realized_price||{};const stk=p.stock||{};
  const label=(s,photo)=>s==='DISPONIVEL'?'Disponível':s==='DISPONIVEL_FOTO'?'Foto disponível'+(photo?' (declarado)':''):s==='PARCIAL'?'Cobertura parcial':s==='SEM_VALOR_VALIDO'?'Sem valor válido':'Sem informação';
  const tone=s=>s==='SEM_INFORMACAO'||s==='SEM_VALOR_VALIDO'?'none':s==='PARCIAL'?'warn':s==='DISPONIVEL'?'ok':'info';
  // Fonte indisponível (SEM_INFORMACAO) → traço; zero só quando a fonte existe e o valor é de fato 0.
  const off=(status,v)=>status==='SEM_INFORMACAO'||v==null?'—':num(v);
  const actions=[];
  if(reg.status==='SEM_INFORMACAO')actions.push('Preço cadastrado e estoque não existem para esta plataforma; não há ação possível nesta versão.');
  if(reg.status==='SEM_VALOR_VALIDO')actions.push('As variações existem, mas nenhuma tem preço válido. Atualize o catálogo antes de usar.');
  if(reg.status==='PARCIAL')actions.push(num(reg.variations_without_valid_price)+' variação(ões) sem preço válido.');
  if(stk.status==='SEM_VALOR_VALIDO')actions.push('Nenhuma variação tem valor de estoque válido.');
  if(stk.status==='PARCIAL')actions.push(num(stk.variations_without_valid_stock)+' variação(ões) sem estoque válido.');
  if(stk.possibly_nominal)actions.push('O valor '+stk.most_common_value+' se repete em '+pct(stk.most_common_share_pct)+' das variações: indício de estoque nominal. Não use como estoque real.');
  return {id:'price-stock',title:'Preço e estoque',lastUpdate:reg.snapshot_last_checked_at||null,
    dims:[{label:'Preço cadastrado',value:label(reg.status,true),tone:tone(reg.status)},{label:'Preço realizado',value:label(rea.status),tone:tone(rea.status)},{label:'Estoque (valor declarado)',value:label(stk.status,true),tone:stk.possibly_nominal?'warn':tone(stk.status)}],
    lines:[['Variações na foto do catálogo',off(reg.status,reg.variations)],
      ['Com preço válido',off(reg.status,reg.variations_with_price)],
      ['Com estoque válido',off(stk.status,stk.variations_with_stock)],
      ['Anúncios com preço realizado no período',off(rea.status,rea.listings_with_units)]],
    details:[],notes:[reg.note,rea.note,stk.note].filter(Boolean),actions};
}

export function batchesCard(data){
  const b=data?.open_batches||[];
  return {id:'batches',title:'Importações abertas',lastUpdate:null,
    dims:[{label:'Situação',value:b.length?b.length+' aberta(s)':'Nenhuma',tone:b.length?'warn':'ok'}],
    lines:b.map(x=>[x.file,'lote '+x.batch_id+' · '+num(x.rows)+' linhas · '+(x.status==='STAGED'?'lida, não aplicada':x.status)+(x.data_through?' · dados até '+fmtDate(x.data_through):'')]),
    details:[],notes:[],
    actions:b.length?['Analise cada arquivo antes de decidir: período, se é parte de um arquivo maior ou relatório antigo, e se substitui dados mais novos. Não aplique relatório antigo nem parte pendente sem essa análise. Descartar também é decisão sua, depois da análise; esta tela não altera nada.']:[]};
}

export function buildCards(data){
  if(!data)return [];
  return [salesCard(data),ordersCard(data),linkCard(data),...reportCards(data),catalogCard(data),priceStockCard(data),batchesCard(data)].filter(Boolean);
}

// ---------- GA-018A: apresentação (só reorganiza; não cria nem altera indicador) ----------
export const SECTIONS=Object.freeze([
  {id:'sales',title:'Vendas e consistência',ids:['sales','orders','link']},
  {id:'sources',title:'Fontes complementares',prefix:'report-'},
  {id:'catalog',title:'Cadastro comercial',ids:['catalog','price-stock']},
  {id:'ops',title:'Operação',ids:['batches']}
]);
export function groupCards(cards){
  return SECTIONS.map(sec=>({id:sec.id,title:sec.title,cards:cards.filter(c=>sec.prefix?c.id.startsWith(sec.prefix):sec.ids.includes(c.id))})).filter(g=>g.cards.length);
}
// Indicadores principais de cada cartão (o resto aparece em "Ver detalhes"); sem rótulo reconhecido, usa os 3 primeiros.
const PRIMARY=Object.freeze({
  sales:['Último dia com venda registrada','Dias sem informação','Meses conferidos internamente'],
  link:['Receita vinculada a anúncio','SKUs sem vínculo','Resíduo (unidades)','Sem anúncio cadastrado','Unidades','Receita'],
  catalog:['Anúncios no catálogo do GA','Sem verificação recente (total)','Verificação mais recente'],
  'price-stock':['Com preço válido','Com estoque válido','Anúncios com preço realizado no período']
});
const REPORT_PRIMARY=['Relatórios','Último período termina em','Pares sobrepostos'];
export function shortText(text,max=96){
  const t=String(text||'').trim();
  const first=t.split(/(?<=[.!?])\s/)[0]||t;
  return first.length>max?first.slice(0,max-1).trimEnd()+'…':first;
}
export function compactCard(card){
  const wanted=card.id.startsWith('report-')?REPORT_PRIMARY:PRIMARY[card.id];
  let primary=card.brief?card.brief.slice(0,3):null;
  if(!primary){
    const picked=wanted?card.lines.filter(([k])=>wanted.includes(k)):[];
    primary=(picked.length?picked:card.lines).slice(0,3);
  }
  const primaryKeys=new Set(primary.map(([k])=>k));
  const more=card.brief?card.lines:card.lines.filter(([k])=>!primaryKeys.has(k));
  const extra=Math.max(0,card.actions.length-1);
  return {...card,primary,more,
    shortAction:card.actions.length?shortText(card.actions[0])+(extra?' (+'+extra+')':''):'',
    hasDetails:more.length>0||card.details.length>0||card.notes.length>0};
}
export function batchRows(data){
  return (data?.open_batches||[]).map(b=>({id:b.batch_id,file:b.file,rows:b.rows,dataThrough:b.data_through,
    status:b.status==='STAGED'?'Lida, não aplicada':b.status}));
}
export function summaryItems(data){
  if(!data)return [];
  const s=data.sales||{};const rec=s.reconciliation||{};const g=data.ga011_shopee||null;
  const divMonths=(rec.divergent_months||[]);
  // Conciliações aplicáveis, separadas: GA-019 (vendas/pedidos, todas as plataformas) e GA-011 (só Shopee).
  const norm=st=>RECONCILIATION[st]?st:'SEM_INFORMACAO';
  const applicable=[['Vendas e pedidos (GA-019)',norm(rec.status)]];
  if(data.platform==='SHOPEE'||g)applicable.push(['Shopee (GA-011)',norm(g?.reconciliation_status)]);
  const states=applicable.map(a=>a[1]);
  let reconText,reconTone;
  if(states.includes('DIVERGENTE'))[reconText,reconTone]=RECONCILIATION.DIVERGENTE;
  else if(states.every(x=>x==='CONCILIADO_INTERNAMENTE'))[reconText,reconTone]=RECONCILIATION.CONCILIADO_INTERNAMENTE;
  else if(states.every(x=>x==='SEM_INFORMACAO'))[reconText,reconTone]=RECONCILIATION.SEM_INFORMACAO;
  else [reconText,reconTone]=['Parcial: parte sem informação','warn'];
  const reconSub=applicable.length>1||reconTone!=='ok'?applicable.map(([l,st])=>l+': '+RECONCILIATION[st][0]).join(' · '):undefined;
  const [freshText,freshTone]=pick(FRESHNESS,s.freshness);
  const reports=data.reports||[];
  // Ads do Mercado Livre (ADS_ML) é a mesma fonte do Ads genérico: conta uma vez só.
  const sourceInfo=new Map();
  for(const r of reports){const k=r.kind==='ADS_ML'?'ADS':r.kind;sourceInfo.set(k,(sourceInfo.get(k)||false)||r.freshness!=='SEM_INFORMACAO');}
  const noInfo=[...sourceInfo.values()].filter(has=>!has).length
    +(data.catalog?.freshness==='SEM_INFORMACAO'?1:0)
    +((data.price_stock?.registered_price?.status==='SEM_INFORMACAO'&&data.price_stock?.stock?.status==='SEM_INFORMACAO')?1:0);
  const totalSources=sourceInfo.size+2;
  const critical=[];
  if(s.freshness==='DESATUALIZADO')critical.push('vendas desatualizadas');
  if(n(s.days_without_information)>0)critical.push('dias sem informação nas vendas');
  if(rec.status==='DIVERGENTE')critical.push('divergência na conciliação interna');
  if(g?.reconciliation_status==='DIVERGENTE')critical.push('resíduo sem explicação na GA-011');
  return [
    {key:'recon',label:'Conciliação interna',value:reconText,sub:reconSub,tone:reconTone,hint:'Consistência entre os arquivos importados; não conferido no marketplace.'},
    {key:'last',label:'Última atualização de vendas',value:fmtDate(s.last_sale_day)||'—',sub:freshText,tone:freshTone,hint:'Vendas: desatualizado se o último dia tem mais de 1 dia de atraso.'},
    {key:'div',label:'Períodos divergentes',value:rec.status==='SEM_INFORMACAO'||rec.months_checked==null?'—':String(divMonths.length),sub:divMonths.length?divMonths.map(m=>fmtMonth(m.month)).join(', '):(rec.months_checked?rec.months_checked+' mês(es) conferido(s)':''),tone:divMonths.length?'bad':(rec.months_checked?'ok':'none'),hint:'Meses inteiros em que resumo, linhas e vendas diárias não batem.'},
    {key:'noinfo',label:'Fontes sem informação',value:noInfo+' de '+totalSources,tone:noInfo?'none':'ok',hint:'Relatórios, catálogo e preço/estoque sem nenhum dado importado.'},
    {key:'crit',label:'Pendências críticas',value:String(critical.length),sub:critical.length?critical.join('; '):'nenhuma',tone:critical.length?'bad':'ok',hint:'Contagem de: vendas desatualizadas, dias sem informação, divergência na conciliação interna ou resíduo sem explicação na GA-011. Não é nota de qualidade.'}
  ];
}
