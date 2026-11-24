import React from 'react';
import {SCOPE_PLATFORMS} from './commerce-platform-scope-logic.js';
import './commerce-platform-scope.css';

// GA-012 — seletor segmentado (Consolidado · Shopee · ML Antigo · ML Novo), igual nos modos overview e explorer.
// Nenhuma opção é desativada nem troca sozinha: se a conta não tem venda no período, a tela diz isso.
export default function PlatformSelector({value,onChange,hints={}}){
  const move=(e,i)=>{
    const dir=e.key==='ArrowRight'||e.key==='ArrowDown'?1:e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:0;
    if(!dir)return;
    e.preventDefault();
    const next=SCOPE_PLATFORMS[(i+dir+SCOPE_PLATFORMS.length)%SCOPE_PLATFORMS.length];
    onChange(next.id);
    e.currentTarget.parentElement?.querySelector('[data-scope="'+next.id+'"]')?.focus();
  };
  return <div className="ndb-scope" role="radiogroup" aria-label="Plataforma">
    {SCOPE_PLATFORMS.map((p,i)=><button key={p.id} type="button" role="radio" data-scope={p.id}
      aria-checked={value===p.id} tabIndex={value===p.id?0:-1}
      className={'ndb-scope-opt'+(value===p.id?' is-active':'')+(hints[p.id]?' is-muted':'')}
      title={hints[p.id]||undefined} style={{'--scope-color':p.color}}
      onClick={()=>onChange(p.id)} onKeyDown={e=>move(e,i)}><i aria-hidden="true"/>{p.label}</button>)}
  </div>;
}
