// Filtro (plataforma, período, mês) compartilhado entre as telas do GA: trocar de tela não muda o que o Lucas escolheu.
// Fica na memória da página e em sessionStorage (some ao fechar a aba). Falha de storage é ignorada.
const KEY='nisti_ga_shared_filter_v1';
const PLATFORMS=['TODAS','SHOPEE','ML_ANTIGO','ML_NOVO'];
const DEFAULT={platform:'TODAS',days:30,month:''};
let mem=null;
function load(){
  if(mem)return mem;
  mem={...DEFAULT};
  try{const raw=globalThis.sessionStorage?.getItem(KEY);if(raw)apply(mem,JSON.parse(raw));}catch{}
  return mem;
}
function apply(target,patch){
  if(patch&&PLATFORMS.includes(patch.platform))target.platform=patch.platform;
  if(patch&&Number.isInteger(patch.days)&&patch.days>=0)target.days=patch.days;
  if(patch&&typeof patch.month==='string'&&(patch.month===''||/^\d{4}(-\d{2})?$/.test(patch.month)))target.month=patch.month;
}
function save(){try{globalThis.sessionStorage?.setItem(KEY,JSON.stringify(mem));}catch{}}
export function getSharedFilter(){return {...load()};}
export function setSharedFilter(patch){apply(load(),patch);save();}
export function resetSharedFilter(){mem={...DEFAULT};save();}
