// Regras puras do painel "Por que parou" (Shopee). Sem rede e sem React: testavel.
export const WHY_DAYS=[7,14,30];
export const CAUSES={
  VISIBILIDADE:{label:'Perdeu visibilidade',short:'Visibilidade',tone:'bad',
    why:'A Shopee está mostrando menos o anúncio.',
    check:['Shopee Ads pausado ou com verba menor','Estoque zerado ou baixo','Posição na busca (pesquise o termo principal)','Anúncio com aviso, suspenso ou fora de promoção']},
  CLIQUE:{label:'Perdeu cliques',short:'Cliques',tone:'warn',
    why:'O anúncio aparece, mas menos gente clica (CTR caiu).',
    check:['Foto principal (comparar com concorrentes na busca)','Título','Preço que aparece na lista de busca','Frete grátis ou selo que sumiu']},
  CONVERSAO:{label:'Perdeu conversão',short:'Conversão',tone:'warn',
    why:'As pessoas entram no anúncio, mas compram menos.',
    check:['Preço e frete contra concorrentes','Avaliações recentes negativas','Variação/cor favorita sem estoque','Prazo de envio ou descrição']},
  SEM_SINAL:{label:'Sem sinal no relatório',short:'Sem sinal',tone:'muted',
    why:'Os relatórios de desempenho não mostram queda em nenhuma etapa.',
    check:['O relatório pode ser anterior à queda: importe um mais recente','Promoção no período anterior (ex.: 11.11) inflando a comparação']},
  SEM_RELATORIO:{label:'Sem relatório',short:'Sem relatório',tone:'muted',
    why:'O anúncio não está nos dois relatórios de desempenho comparados.',
    check:['Importe os relatórios de desempenho dos dois períodos']}
};
export const causeOf=k=>CAUSES[k]||CAUSES.SEM_SINAL;
export const PRICE_UP=10;
export function priceChange(r){
  const a=Number(r?.price_prev),b=Number(r?.price_cur);
  return a>0&&b>0?(b-a)/a*100:null;
}
export const priceRose=r=>{const c=priceChange(r);return c!=null&&c>=PRICE_UP;};
// Etapa marcada em vermelho quando caiu 20% ou mais.
export const BAD_STEP=-20;
export function steps(r){
  return [
    {key:'imp',label:'Impressões/dia',short:'Impressões',before:r.imp_day_before,after:r.imp_day_after,change:r.imp_change,unit:''},
    {key:'ctr',label:'CTR',short:'CTR',before:r.ctr_before,after:r.ctr_after,change:r.ctr_change,unit:'%'},
    {key:'conv',label:'Conversão',short:'Conversão',before:r.conv_before,after:r.conv_after,change:r.conv_change,unit:'%'}
  ].map(s=>({...s,bad:s.change!=null&&Number(s.change)<=BAD_STEP,main:(r.cause==='VISIBILIDADE'&&s.key==='imp')||(r.cause==='CLIQUE'&&s.key==='ctr')||(r.cause==='CONVERSAO'&&s.key==='conv')}));
}
export const FILTERS=[['all','Todos'],['VISIBILIDADE','Perdeu visibilidade'],['CLIQUE','Perdeu cliques'],['CONVERSAO','Perdeu conversão'],['SEM','Sem diagnóstico'],['PRICE','Preço subiu']];
export function filterItems(items,f){
  const rows=Array.isArray(items)?items:[];
  if(f==='all'||!f)return rows;
  if(f==='SEM')return rows.filter(r=>r.cause==='SEM_SINAL'||r.cause==='SEM_RELATORIO');
  if(f==='PRICE')return rows.filter(priceRose);
  return rows.filter(r=>r.cause===f);
}
// O relatorio mais novo termina antes do periodo da queda? Entao o diagnostico olha o passado.
export function reportIsStale(data){
  const end=data?.report_after?.end,start=data?.window?.cur_start;
  return !!(end&&start&&String(end)<String(start));
}
