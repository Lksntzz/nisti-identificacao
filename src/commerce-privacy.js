import { useSyncExternalStore } from 'react';

// Modo privacidade: quando ligado, todo valor em reais (faturamento, preços, gasto) aparece mascarado.
const KEY='ga.privacy';
const MASK='R$ •••••';
let on=false;
try{on=typeof localStorage!=='undefined'&&localStorage.getItem(KEY)==='1';}catch{on=false;}
const subs=new Set();
export const isPrivate=()=>on;
export function setPrivate(v){
  on=Boolean(v);
  try{localStorage.setItem(KEY,on?'1':'0');}catch{/* sem armazenamento: vale só nesta sessão */}
  subs.forEach(f=>f());
}
const subscribe=f=>{subs.add(f);return()=>subs.delete(f);};
export const usePrivacy=()=>useSyncExternalStore(subscribe,isPrivate,()=>false);
// Mantém "—" (sem dado) como está; qualquer outro valor em reais vira a máscara.
export const maskMoney=s=>on&&s!=='—'?MASK:s;
export const MONEY_MASK=MASK;
