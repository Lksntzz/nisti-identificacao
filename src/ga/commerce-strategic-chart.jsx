import React,{useState} from 'react';

// GA-013A — gráficos da Visão estratégica (SVG puro, sem biblioteca). Só unidades.
// Atual = azul sólido; anterior = amarelo tracejado (validado para daltonismo; o contraste do amarelo é compensado por legenda e tabela).
// Pontos/barras "não verificados" ficam vazados/hachurados: o gráfico nunca esconde que a cobertura não está comprovada.
const W=900,H=240,PAD={l:44,r:14,t:14,b:28};
const nf=v=>v==null?'—':Number(v).toLocaleString('pt-BR');
const niceMax=m=>{if(m<=5)return 5;const p=10**Math.floor(Math.log10(m));const f=m/p;return (f<=1?1:f<=2?2:f<=5?5:10)*p;};
const UNVERIFIED=new Set(['NAO_VERIFICADO','NAO_VERIFICADA','SEM_INFORMACAO','COM_LACUNA']);
const STATE_TEXT={NAO_VERIFICADO:'não verificado',NAO_VERIFICADA:'não verificado',SEM_INFORMACAO:'sem informação',COM_LACUNA:'com dias sem informação'};

function Frame({max,children,ticks=4}){
  const ih=H-PAD.t-PAD.b;
  return <>
    {Array.from({length:ticks+1},(_,i)=>{const y=PAD.t+ih-ih*i/ticks;return <g key={i}>
      <line x1={PAD.l} x2={W-PAD.r} y1={y} y2={y} className="nsv-grid"/>
      <text x={PAD.l-6} y={y+3} textAnchor="end" className="nsv-axis">{nf(Math.round(max*i/ticks))}</text></g>;})}
    {children}
  </>;
}
function Legend({current,previous,showHollow}){
  return <div className="nsv-legend" aria-hidden="false">
    <span><i className="sw cur"/>{current}</span><span><i className="sw prev"/>{previous}</span>
    {showHollow&&<span><i className="sw hollow"/>não verificado</span>}
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
  const anyUnv=points.some(p=>UNVERIFIED.has(p.state));
  const onMove=e=>{const r=e.currentTarget.getBoundingClientRect();const rel=(e.clientX-r.left)/r.width*W;
    setHover(Math.max(0,Math.min(points.length-1,Math.round((rel-PAD.l)/iw*(points.length-1)))));};
  const hp=hover!=null?points[hover]:null;
  return <div className="nsv-chart">
    <Legend current={currentLabel} previous={previousLabel} showHollow={anyUnv}/>
    <div className="nsv-chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'Unidades por dia: '+currentLabel+' contra '+previousLabel} onMouseMove={onMove} onMouseLeave={()=>setHover(null)}>
        <Frame max={max}>
          <path d={path('previous')} className="nsv-line prev"/>
          <path d={path('units')} className="nsv-line cur"/>
          {points.map((p,i)=>p.units==null?null:<circle key={i} cx={x(i)} cy={y(p.units)} r={points.length>45?2.2:3.4}
            className={'nsv-dot'+(UNVERIFIED.has(p.state)?' hollow':'')}/>)}
          {points.map((p,i)=>i%step===0||i===points.length-1?<text key={'l'+i} x={x(i)} y={H-8} textAnchor="middle" className="nsv-axis">{p.label}</text>:null)}
          {hp&&<line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H-PAD.b} className="nsv-cross"/>}
        </Frame>
      </svg>
      {hp&&<div className="nsv-tip" style={{left:Math.min(88,Math.max(12,x(hover)/W*100))+'%'}} role="status">
        <b>{hp.full||hp.label}</b>
        <span><i className="sw cur"/>{currentLabel}: {nf(hp.units)}</span>
        <span><i className="sw prev"/>{previousLabel}: {nf(hp.previous)}</span>
        {UNVERIFIED.has(hp.state)&&<em>{STATE_TEXT[hp.state]}</em>}</div>}
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
  const hp=hover!=null?points[hover]:null;
  const bar=(cx,v,cls,unv,key)=>v==null?null:<rect key={key} x={cx} y={y(v)} width={bw} height={Math.max(0,PAD.t+ih-y(v))} rx="3" className={'nsv-bar '+cls+(unv?' unv':'')}/>;
  return <div className="nsv-chart">
    <Legend current={currentLabel} previous={previousLabel} showHollow={anyUnv}/>
    <div className="nsv-chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'Unidades por mês: '+currentLabel+' contra '+previousLabel} onMouseLeave={()=>setHover(null)}>
        <defs><pattern id="nsv-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fcfcfb"/><rect width="3" height="6" fill="#2a78d6" opacity=".55"/></pattern></defs>
        <Frame max={max}>
          {points.map((p,i)=>{const c=PAD.l+slot*i+slot/2,unv=UNVERIFIED.has(p.state);
            return <g key={i} onMouseEnter={()=>setHover(i)}>
              <rect x={PAD.l+slot*i} y={PAD.t} width={slot} height={ih} fill="transparent"/>
              {bar(c-bw-1,p.previous,'prev',false,'p')}{bar(c+1,p.units,'cur',unv,'c')}
              <text x={c} y={H-8} textAnchor="middle" className="nsv-axis">{p.label}</text></g>;})}
        </Frame>
      </svg>
      {hp&&<div className="nsv-tip" style={{left:Math.min(88,Math.max(12,(PAD.l+slot*hover+slot/2)/W*100))+'%'}} role="status">
        <b>{hp.full||hp.label}</b>
        <span><i className="sw cur"/>{currentLabel}: {nf(hp.units)}</span>
        <span><i className="sw prev"/>{previousLabel}: {nf(hp.previous)}</span>
        {UNVERIFIED.has(hp.state)&&<em>{STATE_TEXT[hp.state]}</em>}</div>}
    </div>
  </div>;
}
