import app from './core-router.js';

const FREE_D1_LIMIT_BYTES=500*1024*1024;
const PAID_D1_LIMIT_BYTES=10*1024*1024*1024;
let usageTableReady=false;

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
function saoPauloDay(date=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);const value=Object.fromEntries(parts.map(part=>[part.type,part.value]));return `${value.year}-${value.month}-${value.day}`}
async function ensureUsageTable(env){if(usageTableReady)return;await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_usage_daily (day TEXT PRIMARY KEY,identify_requests INTEGER NOT NULL DEFAULT 0,identify_errors INTEGER NOT NULL DEFAULT 0,embedding_requests INTEGER NOT NULL DEFAULT 0,generation_requests INTEGER NOT NULL DEFAULT 0,prompt_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,total_tokens INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`).run();usageTableReady=true}
function normalizeUsage(row){return {identify_requests:Number(row?.identify_requests||0),identify_errors:Number(row?.identify_errors||0),embedding_requests:Number(row?.embedding_requests||0),generation_requests:Number(row?.generation_requests||0),prompt_tokens:Number(row?.prompt_tokens||0),output_tokens:Number(row?.output_tokens||0),total_tokens:Number(row?.total_tokens||0)}}

async function handleSystemMetrics(env){
  await ensureUsageTable(env);
  const productsProbe=await env.DB.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN image_key IS NOT NULL THEN 1 ELSE 0 END) AS with_image FROM products`).all();
  const productStats=productsProbe.results?.[0]||{};
  const sizeBytes=Number(productsProbe.meta?.size_after||0);
  const embeddingStats=await env.DB.prepare(`SELECT COUNT(*) AS total FROM cover_embeddings`).first();
  const today=saoPauloDay();
  const usageToday=normalizeUsage(await env.DB.prepare(`SELECT * FROM ai_usage_daily WHERE day=?`).bind(today).first());
  const usageTotal=normalizeUsage(await env.DB.prepare(`SELECT SUM(identify_requests) AS identify_requests,SUM(identify_errors) AS identify_errors,SUM(embedding_requests) AS embedding_requests,SUM(generation_requests) AS generation_requests,SUM(prompt_tokens) AS prompt_tokens,SUM(output_tokens) AS output_tokens,SUM(total_tokens) AS total_tokens FROM ai_usage_daily`).first());
  const firstUsage=await env.DB.prepare(`SELECT MIN(day) AS day FROM ai_usage_daily`).first();
  const configuredLimitMb=Number(env.D1_DATABASE_LIMIT_MB||0);
  const configuredLimitBytes=configuredLimitMb>0?Math.round(configuredLimitMb*1024*1024):null;
  return json({ok:true,measured_at:new Date().toISOString(),timezone:'America/Sao_Paulo',database:{status:'online',used_bytes:sizeBytes,products:Number(productStats.total||0),products_with_image:Number(productStats.with_image||0),cover_embeddings:Number(embeddingStats?.total||0),configured_limit_bytes:configuredLimitBytes,configured_percent:configuredLimitBytes&&sizeBytes?(sizeBytes/configuredLimitBytes)*100:null,documented_limits:{workers_free_bytes:FREE_D1_LIMIT_BYTES,workers_paid_bytes:PAID_D1_LIMIT_BYTES},percent_of_free_limit:sizeBytes?(sizeBytes/FREE_D1_LIMIT_BYTES)*100:0,plan_detected:false,plan_note:'O Worker não recebe da Cloudflare qual é o plano da conta.'},gemini:{configured:Boolean(env.GEMINI_API_KEY),model:env.GEMINI_MODEL||'gemini-3.5-flash-lite',embedding_model:env.GEMINI_EMBEDDING_MODEL||'gemini-embedding-2',today:usageToday,since_monitoring:usageTotal,monitoring_started_on:firstUsage?.day||today,average_tokens_per_identification_today:usageToday.identify_requests>0?Math.round(usageToday.total_tokens/usageToday.identify_requests):0,active_quota_available_via_api:false,quota_note:'RPM, TPM e RPD ativos são consultados no Google AI Studio.'}});
}

export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname==='/api/admin/system-metrics'&&request.method==='GET'){try{return await handleSystemMetrics(env)}catch(error){return json({error:error?.message||'Falha ao ler métricas do sistema'},500)}}return app.fetch(request,env,ctx)}};
