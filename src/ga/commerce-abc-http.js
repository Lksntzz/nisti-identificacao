// GA-P01 — borda HTTP da Evolução ABC: leitura dos parâmetros do histórico e resposta com métricas. Sem banco, sem regra de negócio.
import { isAbcPlatform, isAbcMode, LIST_LIMIT } from './commerce-abc-logic.js';

const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const validDay=v=>{if(!DAY.test(v))return false;const t=Date.parse(v+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===v;};
const MAX_SKUS_PARAM=30000; // 200 SKUs de até 120 caracteres cabem com folga

// Filtros na URL (nada sensível: conta, comparação, mês, último dia, versão); a lista de SKUs vai só no corpo do POST de leitura,
// para não passar do limite de URL nem aparecer em logs de infraestrutura.
export function parseAbcHistoryRequest(url,body){
  const g=n=>url.searchParams.get(n);
  const platform=String(g('platform')||'').toUpperCase(),mode=String(g('mode')||''),month=g('month')||null,last=String(g('last')||''),dataVersion=String(g('version')||'');
  if(!isAbcPlatform(platform)||!isAbcMode(mode))return {error:'Filtro do histórico da Evolução ABC inválido.'};
  if(month!=null&&!MONTH.test(month))return {error:'Mês da Evolução ABC inválido.'};
  if(!validDay(last))return {error:'Último dia completo inválido.'};
  if(!dataVersion||dataVersion.length>200)return {error:'Versão dos dados inválida.'};
  if(url.searchParams.has('skus'))return {error:'Lista de SKUs só no corpo da requisição.'};
  const skus=body&&typeof body==='object'?body.skus:undefined;
  if(!Array.isArray(skus)||skus.length>LIST_LIMIT||skus.some(s=>typeof s!=='string'||!s||s.length>120))return {error:'Lista de SKUs inválida.'};
  return {value:{platform,mode,month,last,dataVersion,skus}};
}
export const MAX_BODY_CHARS=MAX_SKUS_PARAM;

// Resposta JSON com o volume (bytes do corpo, sem o próprio campo) em metrics.response_bytes e no cabeçalho x-ga-response-bytes.
// Um log curto por chamada (tempo, consultas, falhas, volume): só números e a conta/modo, nunca SKU nem venda.
export function abcJsonResponse(data,kind){
  const bytes=new TextEncoder().encode(JSON.stringify(data)).length;
  if(data&&data.metrics)data.metrics.response_bytes=bytes;
  try{console.log(JSON.stringify({ev:'ga_abc',kind,platform:data?.platform??null,mode:data?.mode??null,status:data?.status??null,ms:data?.metrics?.elapsed_ms??null,queries:data?.metrics?.queries??null,failed_count:data?.metrics?.failed_count??null,bytes}));}catch{/* log nunca derruba a resposta */}
  return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-ga-response-bytes':String(bytes)}});
}
