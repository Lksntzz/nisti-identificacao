import React,{useState} from 'react';

// GA-013A — gráficos da Visão estratégica (SVG puro, sem biblioteca). Só unidades.
// Atual = azul sólido; anterior = amarelo tracejado (validado para daltonismo; o contraste do amarelo é compensado por legenda e tabela).
// Pontos/barras "não verificados" ficam vazados/hachurados: o gráfico nunca esconde que a cobertura não está comprovada.
const W=900,H=240,PAD={l:44,r:14,t:14,b:28};
const nf=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const niceMax=m=>{if(m<=5)return 5;const p=10**Math.floor(Math.log10(m));const f=m/p;return (f<=1?1:f<=2?2:f<=5?5:10)*p;};
const UNVERIFIED=new Set(['NAO_VERIFICADO','NAO_VERIFICADA','SEM_INFORMACAO','COM_LACUNA']);
const STATE_TEXT={NAO_VERIFICADO:'não verificado',NAO_VERIFICADA:'não verificado',SEM_INFORMACAO:'sem informação',COM_LACUNA:'com dias sem informação'};
// Valor ausente nunca é exibido como zero: dia sem informação diz isso; ausente da fonte aparece como traço.
const val=(v,state)=>v!=null?nf(v):state==='SEM_INFORMACAO'?'sem informação':'—';

function Frame({max,children,ticks=4}){
  const ih=H-PAD.t-PAD.b;
  return <>
    {Array.from({length:ticks+1},(_,i)=>{const y=PAD.t+ih-ih*i/ticks;return <g key={i}>
      <line x1={PAD.l} x2={W-PAD.r} y1={y} y2={y} className="nsv-grid"/>
      <text x={PAD.l-6} y={y+3} textAnchor="end" className="nsv-axis">{nf(Math.round(max*i/ticks))}</text></g>;})}
    {children}
  </>;
}
function Legend({current,previous,showHollow,showGap,showPartial}){
  return <div className="nsv-legend" aria-hidden="false">
    <span><i className="sw cur"/>{current}</span><span><i className="sw prev"/>{previous}</span>
    {showHollow&&<span><i className="sw hollow"/>não verificado</span>}
    {showGap&&<span><i className="sw gap"/>sem informação (lacuna, não é zero)</span>}
    {showPartial&&<span><b className="nsv-star">*</b>mês incompleto</span>}
  </div>;
}

// points: [{label, units, previous, state}]
export function LineChart({points,currentLabel,previousLabel}){
  const [hover,setHover]=useState(null);
  if(!points.length)return null;
  const max=niceMax(Math.max(1,...points.map(p=>Math.max(p.units||0,p.previous||0))));
  const iw=W-PAD.l-PAD.r,ih=H-PAD.t-PAD.b;
  const x=i=>PAD.l+(points.length===1?iw/2:iw*i/(points.length-1));
  const y=v=>PAD.t+ih-ih*(v/max);
  const path=key=>{let d='',pen=false;points.forEach((p,i)=>{if(p[key]==null){pen=false;return;}d+=(pen?'L':'M')+x(i).toFixed(1)+' '+y(p[key]).toFixed(1)+' ';pen=true;});return d;};
  const step=Math.max(1,Math.ceil(points.length/8));
  const anyUnv=points.some(p=>UNVERIFIED.has(p.state)||UNVERIFIED.has(p.previous_state));
  const anyGap=points.some(p=>p.state==='SEM_INFORMACAO'||p.previous_state==='SEM_INFORMACAO');
  const band=iw/Math.max(1,points.length-1);
  const onMove=e=>{const r=e.currentTarget.getBoundingClientRect();const rel=(e.clientX-r.left)/r.width*W;
    setHover(Math.max(0,Math.min(points.length-1,Math.round((rel-PAD.l)/iw*(points.length-1)))));};
  const hp=hover!=null?points[hover]:null;
  return <div className="nsv-chart">
    <Legend current={currentLabel} previous={previousLabel} showHollow={anyUnv} showGap={anyGap}/>
    <div className="nsv-chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'Unidades por dia: '+currentLabel+' contra '+previousLabel} onMouseMove={onMove} onMouseLeave={()=>setHover(null)}>
        <Frame max={max}>
          {points.map((p,i)=>p.state==='SEM_INFORMACAO'?<rect key={'g'+i} x={x(i)-band/2} y={PAD.t} width={band} height={H-PAD.t-PAD.b} className="nsv-gap" data-gap={i}/>:null)}
          {points.map((p,i)=>p.previous_state==='SEM_INFORMACAO'?<text key={'pg'+i} x={x(i)} y={H-PAD.b-6} textAnchor="middle" className="nsv-pgap">×</text>:null)}
          <path d={path('previous')} className="nsv-line prev"/>
          <path d={path('units')} className="nsv-line cur"/>
          {points.map((p,i)=>p.previous==null||!UNVERIFIED.has(p.previous_state)?null:<circle key={'p'+i} cx={x(i)} cy={y(p.previous)} r={points.length>45?2:3} className="nsv-dot prev hollow"/>)}
          {points.map((p,i)=>p.units==null?null:<circle key={i} cx={x(i)} cy={y(p.units)} r={points.length>45?2.2:3.4}
            className={'nsv-dot'+(UNVERIFIED.has(p.state)?' hollow':'')}/>)}
          {points.map((p,i)=>i%step===0||i===points.length-1?<text key={'l'+i} x={x(i)} y={H-8} textAnchor="middle" className="nsv-axis">{p.label}</text>:null)}
          {hp&&<line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H-PAD.b} className="nsv-cross"/>}
        </Frame>
      </svg>
      {hp&&<div className="nsv-tip" style={{left:Math.min(88,Math.max(12,x(hover)/W*100))+'%'}} role="status">
        <b>{hp.full||hp.label}</b>
        <span><i className="sw cur"/>{currentLabel}: {val(hp.units,hp.state)}{hp.state!=='OK'&&hp.state!=='SEM_INFORMACAO'&&<em> ({STATE_TEXT[hp.state]})</em>}</span>
        <span><i className="sw prev"/>{previousLabel}: {val(hp.previous,hp.previous_state)}{hp.previous_state&&hp.previous_state!=='OK'&&hp.previous_state!=='SEM_INFORMACAO'&&<em> ({STATE_TEXT[hp.previous_state]})</em>}</span></div>}
    </div>
  </div>;
}

export function BarChart({points,currentLabel,previousLabel}){
  const [hover,setHover]=useState(null);
  if(!points.length)return null;
  const max=niceMax(Math.max(1,...points.map(p=>Math.max(p.units||0,p.previous||0))));
  const iw=W-PAD.l-PAD.r,ih=H-PAD.t-PAD.b,slot=iw/points.length,bw=Math.min(22,slot/2-3);
  const y=v=>PAD.t+ih-ih*(v/max);
  const anyUnv=points.some(p=>UNVERIFIED.has(p.state));
  const anyPartial=points.some(p=>p.incomplete);
  const hp=hover!=null?points[hover]:null;
  const bar=(cx,v,cls,unv,key)=>v==null?null:<rect key={key} x={cx} y={y(v)} width={bw} height={Math.max(0,PAD.t+ih-y(v))} rx="3" className={'nsv-bar '+cls+(unv?' unv':'')}/>;
  const partialOutline=(cx,v)=>v==null?null:<rect x={cx} y={y(v)} width={bw} height={Math.max(0,PAD.t+ih-y(v))} rx="3" className="nsv-bar-partial"/>;
  return <div className="nsv-chart">
    <Legend current={currentLabel} previous={previousLabel} showHollow={anyUnv} showPartial={anyPartial}/>
    <div className="nsv-chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'Unidades por mês: '+currentLabel+' contra '+previousLabel} onMouseLeave={()=>setHover(null)}>
        <defs><pattern id="nsv-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fcfcfb"/><rect width="3" height="6" fill="#2a78d6" opacity=".55"/></pattern></defs>
        <Frame max={max}>
          {points.map((p,i)=>{const c=PAD.l+slot*i+slot/2,unv=UNVERIFIED.has(p.state);
            return <g key={i} onMouseEnter={()=>setHover(i)}>
              <rect x={PAD.l+slot*i} y={PAD.t} width={slot} height={ih} fill="transparent"/>
              {bar(c-bw-1,p.previous,'prev',UNVERIFIED.has(p.previousInfo?.coverage),'p')}{bar(c+1,p.units,'cur',unv,'c')}{p.incomplete&&partialOutline(c+1,p.units)}
              <text x={c} y={H-8} textAnchor="middle" className="nsv-axis">{p.label}</text></g>;})}
        </Frame>
      </svg>
      {hp&&<div className="nsv-tip" style={{left:Math.min(88,Math.max(12,(PAD.l+slot*hover+slot/2)/W*100))+'%'}} role="status">
        <b>{hp.full||hp.label}</b>
        <span><i className="sw cur"/>{currentLabel}: {val(hp.units)}{UNVERIFIED.has(hp.state)&&<em> ({STATE_TEXT[hp.state]})</em>}</span>
        <span><i className="sw prev"/>{previousLabel} ({hp.previousInfo?.month}): {hp.previousInfo?.absent?'ausente da série':val(hp.previous)}{hp.previousInfo&&UNVERIFIED.has(hp.previousInfo.coverage)&&!hp.previousInfo.absent&&<em> ({STATE_TEXT[hp.previousInfo.coverage]})</em>}{hp.previousInfo?.incomplete&&<em> (mês incompleto)</em>}</span>
        {hp.incomplete&&<em>mês incompleto{hp.incomplete_until?' até '+hp.incomplete_until:''}{hp.incomplete_from?' (dados desde '+hp.incomplete_from+')':''}: não compare com um mês fechado</em>}</div>}
    </div>
  </div>;
}
