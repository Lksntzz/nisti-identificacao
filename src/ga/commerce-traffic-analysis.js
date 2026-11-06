// Comparar apenas métricas do mesmo anúncio, escopo e intervalos equivalentes.
const numberOrNull = x => x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x);
const ratio = (numerator, denominator) =>
  numerator == null || denominator == null || denominator <= 0 ? null : numerator / denominator;
const fmt = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1});
export function analyzeTrafficWindow(current,previous) {
  if(!current||!previous)return {headline:'Comparação indisponível',
    evidence:[],notice:'Importe relatórios dos dois períodos equivalentes e do mesmo tipo de tráfego.'};
  const c={},p={};
  for(const field of ['visits','impressions','clicks','orders']) {
    c[field]=numberOrNull(current[field]);p[field]=numberOrNull(previous[field]);
  }
  const evidence=[];
  function movement(key,label,threshold,minBase) {
    if(c[key]===null||p[key]===null||p[key]<minBase)return;
    const change=(c[key]-p[key])/p[key];
    if(change<=-threshold)evidence.push({
      key,type:'drop',label:label+' em queda',
      text:label+' caiu '+fmt.format(-change*100)+'% entre os períodos. Isso não determina, por si só, o motivo da redução.'
    });
    else if(change>=threshold)evidence.push({
      key,type:'up',label:label+' em crescimento',
      text:label+' aumentou '+fmt.format(change*100)+'% entre os períodos.'
    });
  }
  movement('impressions','Impressões',0.20,100);
  movement('visits','Visitas',0.20,20);
  const previousCtr=ratio(p.clicks,p.impressions),currentCtr=ratio(c.clicks,c.impressions);
  if(previousCtr!==null&&currentCtr!==null&&p.clicks>=5&&p.impressions>=100
    &&(currentCtr-previousCtr)/previousCtr<=-0.20)
    evidence.push({key:'ctr',type:'drop',label:'CTR em queda',
      text:'Cliques por impressão passaram de '+fmt.format(previousCtr*100)+'% para '+
        fmt.format(currentCtr*100)+'%. Revisar relevância da oferta, foto e título é uma hipótese, não causa confirmada.'});
  const previousConversion=ratio(p.orders,p.visits),currentConversion=ratio(c.orders,c.visits);
  if(previousConversion!==null&&currentConversion!==null&&p.orders>=5&&p.visits>=20
    &&previousConversion>0 && (currentConversion-previousConversion)/previousConversion<=-0.20)
    evidence.push({key:'conversion',type:'drop',label:'Conversão do relatório em queda',
      text:'Pedidos por visita caíram de '+fmt.format(previousConversion*100)+'% para '+
        fmt.format(currentConversion*100)+'%. Investigue preço, frete, avaliações e disponibilidade; nenhuma causa está comprovada.'});
  return {headline:evidence.some(x=>x.type==='drop')
      ?'Mudanças objetivas identificadas no tráfego':'Sem queda relevante demonstrada nas métricas disponíveis',
    evidence,notice:'Dados transcritos de relatórios externos. Resultados de tráfego pago não descrevem necessariamente as vendas totais.'};
}
export function trafficDerivedRates(data) {
  const impressions=numberOrNull(data?.impressions),clicks=numberOrNull(data?.clicks);
  const visits=numberOrNull(data?.visits),orders=numberOrNull(data?.orders);
  return {ctr:ratio(clicks,impressions),conversion:ratio(orders,visits)};
}
