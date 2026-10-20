import { commerceRpc as supabaseRpc } from './commerce-rpc.js';
import { supabaseRpc as directSupabaseRpc } from './supabase-read-store.js';

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function cleanId(value) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function cleanPageSize(value, fallback = 50) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(100, Math.trunc(number)));
}

function cleanOffset(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}


export async function commerceSalesDashboard(env, filters = {}) {
  const limit = Math.max(1, Math.min(250, Number(filters.limit || 100) || 100));
  const offset = cleanOffset(filters.offset);
  const result = await supabaseRpc(env, 'commerce_sales_dashboard_v1', {
    p_platform: cleanText(filters.platform) || 'TODAS',
    p_period_start: cleanText(filters.periodStart),
    p_period_end: cleanText(filters.periodEnd),
    p_sku: cleanText(filters.sku),
    p_status: cleanText(filters.status) || 'TODOS',
    p_limit: limit,
    p_offset: offset
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

// Ranking ABC uses imported sales only; does not attribute SKU-level sales to individual ads.
// Time-window sales insights require daily coverage. Missing data is never shown as zero sales.
// Shopee SKU aliases remain auditable and reversible. Only the 26->27
// year swap for PB/PLAN/AGMT with identical remaining SKU is automatic.
// Neither path modifies product or Scanner SKUs or raw sale rows.
async function refreshShopeeYearAliases(env) {
  try {
    return await supabaseRpc(env,'commerce_shopee_auto_link_year26_v1',{},
      {timeoutMs:15000});
  } catch (error) {
    // A completed import must never be reported as failed by a later,
    // independently repeatable sales-SKU reconciliation step.
    console.error('[Commerce] Não foi possível atualizar os vínculos anuais Shopee.',
      String(error?.message||error));
    return null;
  }
}
// Relatório somente de leitura: vendeu na Shopee, mas o SKU da venda
// não possui anúncio/variação ativa exclusivamente comprovados.
export async function commerceShopeeUnlinkedSales(env, filters = {}) {
  const days=[0,7,30,60,90].includes(Number(filters.days))?Number(filters.days):30;
  const data=await supabaseRpc(env,'commerce_shopee_unlinked_sales_v1',{
    p_days:days,p_month:days===0?cleanText(filters.month):null,
    p_search:cleanText(filters.search),
    p_limit:cleanPageSize(filters.limit,20),
    p_offset:cleanOffset(filters.offset)
  },{timeoutMs:9000});
  return data && typeof data==='object' && !Array.isArray(data)
    ?data:{items:[],total:0,units:0,revenue:0};
}

export async function commerceShopeeSkuReconciliationQueue(env, filters = {}) {
  const value = await supabaseRpc(env,'commerce_shopee_sku_reconciliation_queue_v1',{
    p_search:cleanText(filters.search),
    p_state:['PENDING','APPROVED','REVIEWED'].includes(filters.state)?filters.state:'PENDING',
    p_limit:cleanPageSize(filters.limit,20),
    p_offset:cleanOffset(filters.offset)
  });
  return value && typeof value==='object' && !Array.isArray(value)
    ?value:{items:[],total:0};
}

// Historical review accepts real sales without inventing a listing/variation owner.
export async function commerceShopeeReviewUnlinkedHistory(env,input={},actor='Administrador') {
  const evidence=cleanText(input.evidence);
  if (input.confirmed!==true||!evidence||evidence.length<8||evidence.length>500)
    throw new Error('Confirme a validação do histórico sem vínculo e sua justificativa.');
  return await supabaseRpc(env,'commerce_shopee_review_unlinked_history_v1',{
    p_actor:String(actor||'Administrador').slice(0,120),
    p_evidence:evidence,p_confirmed:true
  },{timeoutMs:15000});
}

export async function commerceShopeeReopenUnlinkedHistory(env,sku,actor='Administrador') {
  const source=cleanText(sku);
  if(!source||source.length>160)throw new Error('SKU inválido.');
  return await supabaseRpc(env,'commerce_shopee_reopen_unlinked_history_v1',{
    p_source_sku:source,
    p_actor:String(actor||'Administrador').slice(0,120)
  });
}

export async function commerceShopeeSkuCandidates(env, search) {
  const q=cleanText(search);
  if (!q || q.length<2 || q.length>120)
    throw new Error('Informe pelo menos dois caracteres para buscar uma variação.');
  const value=await supabaseRpc(env,'commerce_shopee_sku_candidate_search_v1',{
    p_search:q,p_limit:20
  });
  return {items:Array.isArray(value)?value:[]};
}

export async function commerceShopeeSkuConfirm(env,input={},actor='Administrador') {
  const sku=cleanText(input.sku);
  const variationId=cleanId(input.variation_id);
  const evidence=cleanText(input.evidence);
  if (!sku || sku.length>160 || !variationId || !evidence
    || evidence.length<8 || evidence.length>500 || input.confirmed!==true)
    throw new Error('Confirme o SKU, a variação e uma justificativa verificável.');
  return await supabaseRpc(env,'commerce_shopee_confirm_sku_alias_v1',{
    p_source_sku:sku,p_listing_product_id:variationId,
    p_evidence:evidence,p_actor:String(actor||'Administrador').slice(0,120),
    p_confirmed:true
  });
}

export async function commerceShopeeSkuRevoke(env,sku,actor='Administrador') {
  const source=cleanText(sku);
  if (!source || source.length>160)throw new Error('SKU Shopee inválido.');
  return await supabaseRpc(env,'commerce_shopee_revoke_sku_alias_v1',{
    p_source_sku:source,p_actor:String(actor||'Administrador').slice(0,120)
  });
}

export async function commerceListingManager(env, filters = {}) {
  if (Number(filters.days)===0 && cleanText(filters.month) && cleanText(filters.platform)==='SHOPEE') {
    const monthData=await supabaseRpc(env,'commerce_listing_manager_month_sku_v2',{
      p_platform:'SHOPEE',
      p_month:cleanText(filters.month),
      p_search:cleanText(filters.search),
      p_status:cleanText(filters.status)||'ALL',
      p_curve:cleanText(filters.curve)||'ALL',
      p_limit:cleanPageSize(filters.limit,20),
      p_offset:cleanOffset(filters.offset),
      p_basis:cleanText(filters.basis)==='UNITS'?'UNITS':'REVENUE'
    }, {timeoutMs:9000});
    return monthData && typeof monthData==='object' && !Array.isArray(monthData)
      ?monthData:{items:[],total:0,kpis:{}};
  }
  const data = await supabaseRpc(env, 'commerce_listing_manager_v1', {
    p_platform: cleanText(filters.platform) || 'TODAS',
    p_days: [0,7,30,60,90].includes(Number(filters.days)) ? Number(filters.days) : 30,
    p_reference_month: Number(filters.days)===0 ? cleanText(filters.month) : null,
    p_search: cleanText(filters.search),
    p_status: cleanText(filters.status) || 'ALL',
    p_curve: cleanText(filters.curve) || 'ALL',
    p_basis: cleanText(filters.basis) || 'REVENUE',
    p_limit: cleanPageSize(filters.limit, 20),
    p_offset: cleanOffset(filters.offset)
  }, {timeoutMs:9000});
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data : { items: [], total: 0, kpis: {} };
}

// Actionable product trends from complete dated Shopee SKU + ML item imports.
// Comparisons use equal windows, avoid fake zeros when day coverage is absent.
export async function commerceSalesEvolution(env, filters={}) {
  const platform=cleanText(filters.platform)||'TODAS';
  const days=Number(filters.days);
  const status=cleanText(filters.status)||'ALL';
  const search=cleanText(filters.search)||null;
  if(!['TODAS','MERCADO_LIVRE','ML_ANTIGO','ML_NOVO','SHOPEE'].includes(platform)
    ||![7,30,60,90].includes(days)
    ||!['ALL','RISING','FALLING','STABLE','ZERO','NEW','LOW_VOLUME','INSUFFICIENT'].includes(status)
    ||(search&&search.length>120))throw new Error('Filtros de evolução inválidos.');
  const result=await supabaseRpc(env,'commerce_sales_evolution_v1',{
    p_platform:platform,p_days:days,p_status:status,p_search:search,
    p_limit:cleanPageSize(filters.limit,25),
    p_offset:cleanOffset(filters.offset)
  },{timeoutMs:15000});
  return result&&typeof result==='object'&&!Array.isArray(result)
    ?result:{items:[],total:0,kpis:{},coverage:[]};
}

export async function commerceListingManagerMonthly(env, platform='TODAS') {
  if (cleanText(platform)==='SHOPEE') {
    const linked=await supabaseRpc(env,'commerce_listing_manager_monthly_sku_v1',{
      p_platform:'SHOPEE'
    });
    return linked && typeof linked==='object' && !Array.isArray(linked)
      ?linked:{months:[]};
  }
  const data = await supabaseRpc(env,'commerce_listing_manager_monthly_v1',{
    p_platform:cleanText(platform)||'TODAS'
  });
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {months:[]};
}

// Summary of distinct imported orders by platform / monthly period; detailed
// advertisement-level order incidence is NOT a distinct order count.
// Source-of-truth totals for ALL imported sales: include SKU/unlisted orders.
// Scope matches the manager's displayed date range; no SKU alias is required.
// Métricas externas por anúncio, janela exata e origem de tráfego.
const validReportDate = value => {
  const s=String(value||'');
  return /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)
    && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0,10)===s;
};
function validateTrafficBounds(start,end) {
  if(!validReportDate(start)||!validReportDate(end))throw new Error('Datas de tráfego inválidas.');
  const days=(Date.parse(end)-Date.parse(start))/86400000+1;
  if(days<1||days>91)throw new Error('Intervalo de tráfego deve ter de 1 a 91 dias.');
}
function nullableMetric(value) {
  if(value==null||value==='')return null;
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>1e12)
    throw new Error('Métrica de tráfego inválida.');
  return value;
}
// Shopee Ads are campaign attribution metrics; never write them to order or SKU sales tables.
export async function commerceImportShopeeAdsReport(env,input={}) {
  const report=input.report,rows=input.rows;
  if(!report||!Array.isArray(rows)||rows.length<1||rows.length>1000)
    throw new Error('Relatório de publicidade inválido.');
  if(!['GENERAL','TARGETING'].includes(report.kind)
     || !/^\d{3,24}$/.test(String(report.shop_id||''))
     || !/^[a-f0-9]{64}$/.test(String(report.sha256||'')))
    throw new Error('Identificação de origem inválida.');
  if(!validReportDate(report.start)||!validReportDate(report.end)||
    (Date.parse(report.end)-Date.parse(report.start))/86400000<0||
    (Date.parse(report.end)-Date.parse(report.start))/86400000>366)
    throw new Error('Período acumulado de Shopee Ads inválido.');
  return await supabaseRpc(env,'commerce_shopee_ads_import_v1',{
    p_report:report,p_rows:rows
  },{timeoutMs:20000});
}
// Return/refund events are separate records; never mutate sales totals.
export async function commerceImportShopeeAftercare(env,input={}) {
  const report=input?.report,requests=input?.requests;
  if(!report||!Array.isArray(requests)||requests.length<1||requests.length>3000
    ||!/^[a-f0-9]{64}$/.test(String(report.sha256||''))
    ||!validReportDate(report.start)||!validReportDate(report.end))
    throw new Error('Planilha de pós-venda inválida.');
  return await supabaseRpc(env,'commerce_shopee_aftercare_import_v1',{
    p_report:report,p_requests:requests
  },{timeoutMs:30000});
}
export async function commerceShopeeAftercareListing(env,listingId) {
  const id=cleanId(listingId);
  if(!id)throw new Error('Anúncio inválido.');
  const data=await supabaseRpc(env,'commerce_shopee_aftercare_listing_v1',{
    p_listing_id:id
  },{timeoutMs:10000});
  return data && typeof data==='object'&&!Array.isArray(data)?data:{counts:null,items:[]};
}

export async function commerceShopeeAdsCoverage(env,ids=[]) {
  if(!Array.isArray(ids)||ids.length<1||ids.length>50||
    ids.some(id=>!Number.isSafeInteger(Number(id))||Number(id)<1)) {
    throw new Error('IDs de anúncios inválidos para consulta Shopee Ads.');
  }
  const result=await supabaseRpc(env,'commerce_shopee_ads_coverage_v1',{
    p_listing_ids:ids.map(Number)
  },{timeoutMs:9000});
  return {listing_ids:Array.isArray(result)?result.map(Number):[]};
}

export async function commerceShopeeAdsListing(env,listingId) {
  const id=cleanId(listingId);
  if(!id)throw new Error('ID do anúncio inválido.');
  const rows=await supabaseRpc(env,'commerce_shopee_ads_listing_v1',{
    p_listing_id:id
  },{timeoutMs:9000});
  return {items:Array.isArray(rows)?rows:[]};
}

export async function commerceListingTrafficWindow(env,listingId,filters={}) {
  const id=cleanId(listingId);
  if(!id)throw new Error('Anúncio inválido.');
  validateTrafficBounds(filters.start,filters.end);
  return await supabaseRpc(env,'commerce_listing_traffic_window_v1',{
    p_listing_id:id,p_period_start:filters.start,p_period_end:filters.end
  },{timeoutMs:9000});
}
export async function commerceSaveListingTraffic(env,listingId,input={},actor='Administrador') {
  const id=cleanId(listingId);
  if(!id)throw new Error('Anúncio inválido.');
  validateTrafficBounds(input.start,input.end);
  const scope=String(input.scope||'').toUpperCase();
  const label=String(input.source||'').trim();
  if(!['ALL','ORGANIC','PAID'].includes(scope)||label.length<8||label.length>200)
    throw new Error('Informe o tipo de tráfego e a referência do relatório.');
  const visits=nullableMetric(input.visits),impressions=nullableMetric(input.impressions);
  const clicks=nullableMetric(input.clicks),orders=nullableMetric(input.orders);
  if([visits,impressions,clicks,orders].every(x=>x===null)
    || (impressions!==null&&clicks!==null&&clicks>impressions))
    throw new Error('Informe métricas válidas; cliques não podem superar impressões.');
  return await supabaseRpc(env,'commerce_save_listing_traffic_v1',{
    p_listing_id:id,p_period_start:input.start,p_period_end:input.end,
    p_scope:scope,p_visits:visits,p_impressions:impressions,p_clicks:clicks,p_orders:orders,
    p_source_label:label,p_actor:String(actor||'Administrador').slice(0,120)
  },{timeoutMs:9000});
}

export async function commerceImportedSalesTotals(env,filters={}) {
  const platform=cleanText(filters.platform)||'TODAS';
  const start=cleanText(filters.start),end=cleanText(filters.end);
  if(!['TODAS','SHOPEE','MERCADO_LIVRE','ML_ANTIGO','ML_NOVO','AMAZON','TIKTOK'].includes(platform)
    ||!/^20\d{2}-\d{2}-\d{2}$/.test(start||'')
    ||!/^20\d{2}-\d{2}-\d{2}$/.test(end||'')
    ||start>end)
    throw new Error('Plataforma ou intervalo de vendas inválido.');
  const result=await supabaseRpc(env,'commerce_imported_sales_totals_v1',{
    p_platform:platform,p_start:start,p_end:end,p_monthly:Boolean(filters.monthly)
  },{timeoutMs:12000});
  return result&&typeof result==='object'&&!Array.isArray(result)
    ?result:{available:false,sources:[],units:null,revenue:null};
}

export async function commerceOrderMetrics(env,filters={}) {
  const days=Number(filters.days);
  const platform=cleanText(filters.platform)||'TODAS';
  const month=cleanText(filters.month)||null;
  const listingId=filters.listingId==null?null:Number(filters.listingId);
  if(![0,7,30,60,90].includes(days)
    ||(days===0&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||''))
    ||(days!==0&&month)
    ||(listingId!==null&&(!Number.isSafeInteger(listingId)||listingId<=0)))
    throw new Error('Período ou anúncio inválido.');
  const result=await supabaseRpc(env,'commerce_order_metrics_v1',{
    p_platform:platform,p_days:days,p_month:month,p_listing_id:listingId
  },{timeoutMs:12000});
  return result&&typeof result==='object'&&!Array.isArray(result)?result:{};
}

export async function commerceListingManagerMonths(env, listingId) {
  const id = Number(listingId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('ID do anúncio inválido.');
  const data = await supabaseRpc(env, 'commerce_listing_manager_months_v1', {p_listing_id:id});
  // Additional READ-ONLY model-level history: the original and updated
  // SKUs remain separate, and no order is assigned to an invented ad ID.
  const model = await supabaseRpc(env,'commerce_shopee_model_sales_history_v1',{
    p_listing_id:id
  }).catch(()=>null);
  const result=data && typeof data==='object' && !Array.isArray(data)
    ?data:{listing_id:id,months:[]};
  return {...result,model_history:model?.months?.length?model:null};
}

export async function commerceSalesVelocity(env, filters = {}) {
  const value = await supabaseRpc(env, 'commerce_sales_velocity_v2', {
    p_days: Number(filters.days) || 30,
    p_platform: cleanText(filters.platform) || 'TODAS',
    p_reference_month: cleanText(filters.month),
    p_status: cleanText(filters.status) || 'ALL',
    p_limit: cleanPageSize(filters.limit, 15),
    p_offset: cleanOffset(filters.offset)
  });
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value : {items:[],status:'NO_IMPORT',metrics:{sold:null,zero:null,low:null,rising:null}};
}


export async function commerceSalesAbcWindow(env, filters = {}) {
  return await supabaseRpc(env,'commerce_sales_abc_window_v1',{
    p_platform:cleanText(filters.platform)||'TODAS',
    p_days:Number(filters.days)||30,
    p_reference_month:cleanText(filters.month),
    p_basis:cleanText(filters.basis)||'REVENUE'
  });
}

export async function commerceSalesAbcAdsWindow(env, filters = {}) {
  return await supabaseRpc(env,'commerce_sales_abc_ads_window_v1',{
    p_platform:cleanText(filters.platform)||'TODAS',
    p_days:Number(filters.days)||30,
    p_reference_month:cleanText(filters.month),
    p_basis:cleanText(filters.basis)||'REVENUE',
    p_class:cleanText(filters.curve)||'A',
    p_limit:cleanPageSize(filters.limit,15),
    p_offset:cleanOffset(filters.offset)
  });
}

export async function commerceSalesAbc(env, filters = {}) {
  const value = await supabaseRpc(env, 'commerce_sales_abc_v1', {
    p_platform: cleanText(filters.platform) || 'TODAS',
    p_period_start: cleanText(filters.periodStart),
    p_period_end: cleanText(filters.periodEnd),
    p_basis: cleanText(filters.basis) || 'REVENUE'
  });
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// Paginated ABC drilldown: SKU totals plus its actual active marketplace advertisements.
export async function commerceSalesAbcAds(env, filters = {}) {
  const result = await supabaseRpc(env, 'commerce_sales_abc_ads_v1', {
    p_platform: cleanText(filters.platform) || 'TODAS',
    p_period_start: cleanText(filters.periodStart),
    p_period_end: cleanText(filters.periodEnd),
    p_basis: cleanText(filters.basis) || 'REVENUE',
    p_class: cleanText(filters.curve) || 'A',
    p_limit: cleanPageSize(filters.limit, 15),
    p_offset: cleanOffset(filters.offset)
  });
  return result && typeof result === 'object' && !Array.isArray(result)
    ? result : {items:[],total:0,has_sales:false};
}

export async function commerceSalesProductPerformance(env, filters = {}) {
  const limit = Math.max(1, Math.min(250, Number(filters.limit || 100) || 100));
  const offset = cleanOffset(filters.offset);
  const result = await supabaseRpc(env, 'commerce_sales_product_performance_v1', {
    p_platform: cleanText(filters.platform) || 'TODAS',
    p_period_start: cleanText(filters.periodStart),
    p_period_end: cleanText(filters.periodEnd),
    p_situation: cleanText(filters.situation) || 'TODOS',
    p_search: cleanText(filters.search),
    p_limit: limit,
    p_offset: offset
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceDashboard(env) {
  const result = await supabaseRpc(env, 'commerce_dashboard_v1');
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function nistiProductsSalesPlanning(env, filters = {}) {
  const ids = [...new Set((Array.isArray(filters.productIds) ? filters.productIds : [])
    .map(cleanId).filter(Boolean))].slice(0,100);
  if (!ids.length) return { items: [] };
  return await directSupabaseRpc(env,'nisti_products_sales_planning_v1',{
    p_nisti_ids:ids,
    p_platform:cleanText(filters.platform)||'TODAS',
    p_months:Math.max(1,Math.min(12,Number(filters.months)||3))
  });
}

export async function commerceProductSalesPlanning(env, filters = {}) {
  const ids = [...new Set((Array.isArray(filters.productIds) ? filters.productIds : [])
    .map(cleanId).filter(Boolean))].slice(0,100);
  if (!ids.length) return { items: [] };
  const result = await supabaseRpc(env,'commerce_product_sales_planning_v1',{
    p_product_ids:ids,
    p_platform:cleanText(filters.platform)||'TODAS',
    p_months:Math.max(1,Math.min(12,Number(filters.months)||3))
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {items:[]};
}

export async function commerceProducts(env, filters = {}) {
  const limit = cleanPageSize(filters.limit);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, filters.presence && filters.presence !== 'ALL'
    ? 'commerce_list_products_planning_cards_v1' : 'commerce_list_products_v3', {
    p_search: cleanText(filters.search),
    p_marketplace_code: cleanText(filters.marketplace),
    p_category_id: cleanId(filters.categoryId),
    p_internal_status: cleanText(filters.status),
    p_limit: limit,
    p_offset: offset,
    ...(filters.presence && filters.presence !== 'ALL' ? {p_presence:filters.presence} : {})
  });

  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}

export async function commerceProductDetail(env, productId) {
  const id = cleanId(productId);
  if (!id) throw new Error('product_id inválido.');
  const result = await supabaseRpc(env, 'commerce_product_platform_detail_v2', {
    p_product_id: id
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceListingHistory(env, { group = 'ALL', accountCode = 'ALL', limit = 30, offset = 0 } = {}) {
  const normalizedGroup = String(group || 'ALL').toUpperCase();
  if (!['ALL', 'ACTIVE', 'DEACTIVATED', 'UNKNOWN'].includes(normalizedGroup)) throw new Error('Filtro de anúncios inválido.');
  const normalizedAccount = String(accountCode || 'ALL').toUpperCase();
  if (!['ALL', 'ANTIGO', 'NOVO', 'UNASSIGNED'].includes(normalizedAccount)) throw new Error('Conta de anúncios inválida.');
  const result = await supabaseRpc(env, 'commerce_listing_history_account_v1', {
    p_group: normalizedGroup,
    p_account_code: normalizedAccount,
    p_limit: cleanPageSize(limit, 30),
    p_offset: cleanOffset(offset)
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

// One NISTI SKU per Catalog row. Marketplace listings remain separate child records.
// The Catalog is based on ACTIVE seller advertisements, regardless of Scanner synchronization.
export async function commerceActiveProductCatalog(env, filters = {}) {
  const data = await supabaseRpc(env, 'commerce_active_product_catalog_v1', {
    p_search: cleanText(filters.search),
    p_marketplace_code: cleanText(filters.marketplace),
    p_limit: cleanPageSize(filters.limit, 25),
    p_offset: cleanOffset(filters.offset)
  });
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data : { items: [], total: 0, active_ads: 0 };
}

export async function commerceSkuListingGroups(env, filters = {}) {
  const data = await supabaseRpc(env, 'commerce_sku_listing_groups_v1', {
    p_search: cleanText(filters.search),
    p_marketplace_code: cleanText(filters.marketplace),
    p_period_month: cleanText(filters.periodMonth) ? cleanText(filters.periodMonth) + '-01' : null,
    p_limit: cleanPageSize(filters.limit, 25),
    p_offset: cleanOffset(filters.offset)
  });
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data : { items: [], total: 0 };
}

export async function commerceSaveListingSales(env, input = {}, operator = 'Administrador') {
  const listingId = cleanId(input.listingId);
  const productId = cleanId(input.productId);
  const units = Number(input.units);
  const month = String(input.periodMonth || '').trim();
  if (!listingId || !productId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    || !Number.isSafeInteger(units) || units < 0 || units > 100000000) {
    throw new Error('Dados de vendas por anúncio inválidos.');
  }
  return await supabaseRpc(env, 'commerce_save_listing_sales_v1', {
    p_listing_id: listingId,
    p_nisti_product_id: productId,
    p_period_month: month + '-01',
    p_units: units,
    p_actor: String(operator || 'Administrador').slice(0,120)
  });
}

export async function commerceListings(env, filters = {}) {
  const limit = cleanPageSize(filters.limit);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_listings_v4', {
    p_search: cleanText(filters.search),
    p_marketplace_code: cleanText(filters.marketplace),
    p_listing_status: cleanText(filters.status),
    p_limit: limit,
    p_offset: offset
  });

  const items = Array.isArray(rows) ? rows : [];
  // The active Catalog is listing-centric. Fetch child variants by the
  // marketplace variation ID, including items not linked to a Scanner SKU yet.
  if (cleanText(filters.status) === 'ACTIVE' && items.length) {
    const listingIds = items
      .map(item => cleanId(item.listing_id))
      .filter(Boolean);
    const sourceVariations = listingIds.length
      ? await supabaseRpc(env, 'commerce_catalog_listing_variations_v1', {
          p_listing_ids: listingIds
        })
      : [];
    const byListingId = new Map(
      (Array.isArray(sourceVariations) ? sourceVariations : [])
        .map(row => [Number(row.listing_id), Array.isArray(row.variations) ? row.variations : []])
    );
    return {
      items: items.map(item => ({
        ...item,
        catalog_variations: byListingId.get(Number(item.listing_id))
          || (Array.isArray(item.variation_options) ? item.variation_options : [])
      })),
      limit,
      offset
    };
  }

  return { items, limit, offset };
}

// All active advertisements missing a confirmed Scanner link; independent of Commerce master counts.
export async function commerceScannerPendingActive(env, filters = {}) {
  const result = await supabaseRpc(env,'commerce_scanner_pending_active_v1',{
    p_search:cleanText(filters.search),
    p_limit:cleanPageSize(filters.limit,15),
    p_offset:cleanOffset(filters.offset)
  });
  return result && typeof result==='object' && !Array.isArray(result)
    ? result : {items:[],total:0,limit:15,offset:0};
}

export async function commerceLinkActiveAdScanner(env, input = {}) {
  const listingId=cleanId(input.listingId);
  const scannerId=cleanId(input.scannerProductId);
  const sku=cleanText(input.sku);
  if(!listingId || !scannerId || !sku || sku.length>120){
    throw new Error('Informe anúncio, produto Scanner e SKU válidos.');
  }
  return await supabaseRpc(env,'commerce_link_active_ad_scanner_v1',{
    p_listing_id:listingId,
    p_nisti_product_id:scannerId,
    p_sku:sku
  });
}

export async function commerceManagementProducts(env, filters = {}) {
  const limit = cleanPageSize(filters.limit, 24);
  const offset = cleanOffset(filters.offset);
  const year = Number(filters.year || 0);
  const presence = cleanText(filters.presence) || 'LINKED';
  const rpcName = presence === 'LINKED'
    ? 'commerce_management_products_fast_v1'
    : 'commerce_management_products_v3';
  const params = rpcName === 'commerce_management_products_fast_v1'
    ? {
        p_search: cleanText(filters.search),
        p_category: cleanText(filters.category),
        p_year: Number.isInteger(year) && year > 0 ? year : null,
        p_limit: limit,
        p_offset: offset
      }
    : {
        p_search: cleanText(filters.search),
        p_category: cleanText(filters.category),
        p_year: Number.isInteger(year) && year > 0 ? year : null,
        p_presence: cleanText(filters.presence) || 'LINKED',
        p_limit: limit,
        p_offset: offset
      };
  const rows = await supabaseRpc(env, rpcName, params);

  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}

export async function commerceManagementLinkCandidates(env, sourceRowId) {
  const id = cleanId(sourceRowId);
  if (!id) throw new Error('source_row_id inválido.');
  const result = await supabaseRpc(env, 'commerce_management_link_candidates_v2', {
    p_source_row_id: id
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceResolveManagementLink(env, sourceRowId, productId, operator = null) {
  const rowId = cleanId(sourceRowId);
  const linkedProductId = cleanId(productId);
  if (!rowId) throw new Error('source_row_id inválido.');
  if (!linkedProductId) throw new Error('product_id inválido.');
  const result = await supabaseRpc(env, 'commerce_management_resolve_link_v1', {
    p_source_row_id: rowId,
    p_product_id: linkedProductId,
    p_operator: cleanText(operator)
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceManagementProductSummary(env) {
  const result = await supabaseRpc(env, 'commerce_management_product_summary_v2');
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceManagement(env, filters = {}) {
  const limit = cleanPageSize(filters.limit);
  const offset = cleanOffset(filters.offset);
  const year = Number(filters.year || 0);
  const rows = await supabaseRpc(env, 'commerce_management_rows_v1', {
    p_source_code: cleanText(filters.source) || 'AMAZON',
    p_search: cleanText(filters.search),
    p_category: cleanText(filters.category),
    p_update_status: cleanText(filters.updateStatus),
    p_video_status: cleanText(filters.videoStatus),
    p_listing_status: cleanText(filters.listingStatus),
    p_image_status: cleanText(filters.imageStatus),
    p_relation_status: cleanText(filters.relationStatus),
    p_year: Number.isInteger(year) && year > 0 ? year : null,
    p_limit: limit,
    p_offset: offset
  });

  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}

export async function commerceManagementFilterOptions(env, sourceCode = 'AMAZON') {
  const result = await supabaseRpc(env, 'commerce_management_filter_options_v1', {
    p_source_code: cleanText(sourceCode) || 'AMAZON'
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceManagementSummary(env, sourceCode = 'AMAZON') {
  const result = await supabaseRpc(env, 'commerce_management_summary_v1', {
    p_source_code: cleanText(sourceCode) || 'AMAZON'
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceManagementDetail(env, sourceRowId) {
  const id = cleanId(sourceRowId);
  if (!id) throw new Error('source_row_id inválido.');
  const result = await supabaseRpc(env, 'commerce_management_detail_v1', {
    p_source_row_id: id
  });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceImportBatches(env, filters = {}) {
  const limit = cleanPageSize(filters.limit, 30);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_import_batches_v1', {
    p_limit: limit,
    p_offset: offset
  });
  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}

export async function commerceCreateImportBatch(env, input = {}) {
  const batchId = await supabaseRpc(env, 'commerce_create_import_batch_v2', {
    p_marketplace_code: cleanText(input.marketplace),
    p_source_filename: cleanText(input.filename),
    p_source_sha256: cleanText(input.sha256),
    p_created_by: cleanText(input.createdBy),
    p_account_code: cleanText(input.accountCode)
  });
  const id = Number(batchId || 0);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Supabase não retornou um batch_id válido.');
  return id;
}

export async function commerceDeleteImportBatch(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  return await supabaseRpc(env, 'commerce_delete_import_batch_v1', { p_batch_id: id });
}

export async function commerceAppendImportRows(env, batchId, rows = []) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) {
    throw new Error('Cada lote deve conter entre 1 e 100 linhas.');
  }
  const inserted = await supabaseRpc(env, 'commerce_append_import_rows_v1', {
    p_batch_id: id,
    p_rows: rows
  });
  return Number(inserted || 0);
}

export async function commerceFinalizeImportBatch(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  return await supabaseRpc(env, 'commerce_finalize_import_batch_v1', { p_batch_id: id });
}

export async function commerceImportBatch(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  return await supabaseRpc(env, 'commerce_import_batch_account_v1', { p_batch_id: id });
}

export async function commerceReconcileImportBatch(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  return await supabaseRpc(env, 'commerce_reconcile_import_batch_auto_v1', { p_batch_id: id }, { timeoutMs: 30000 });
}

export async function commerceImportRows(env, batchId, filters = {}) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  const limit = cleanPageSize(filters.limit);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_import_rows_v1', {
    p_batch_id: id,
    p_status: cleanText(filters.status),
    p_limit: limit,
    p_offset: offset
  });
  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}

export async function commerceDecideImportRow(env, rowId, action, productId = null) {
  const id = cleanId(rowId);
  if (!id) throw new Error('import_row_id inválido.');
  const product = productId == null ? null : cleanId(productId);
  return await supabaseRpc(env, 'commerce_decide_import_row_v1', {
    p_import_row_id: id,
    p_action: cleanText(action),
    p_product_id: product
  });
}

export async function commerceApproveNewRows(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  const count = await supabaseRpc(env, 'commerce_approve_new_rows_v2', { p_batch_id: id });
  return Number(count || 0);
}

export async function commerceApproveProbableRows(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  const result = await supabaseRpc(env, 'commerce_approve_probable_rows_v1', { p_batch_id: id });
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceSyncImportListingStates(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  return await supabaseRpc(env, 'commerce_sync_import_listing_states_account_v1', { p_batch_id: id });
}

export async function commerceCommitImportBatch(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  const result=await supabaseRpc(env, 'commerce_commit_import_batch_account_v4', { p_batch_id: id });
  // New active SKU owners can become available when the catalogue is imported.
  await refreshShopeeYearAliases(env);
  return result;
}


export async function commerceReconciliationQueue(env, filters = {}) {
  const limit = cleanPageSize(filters.limit, 50);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_reconciliation_queue_v1', {
    p_limit: limit,
    p_offset: offset
  });
  return { items: Array.isArray(rows) ? rows : [], limit, offset };
}

export async function commerceResolveReconciliationListing(env, listingId, input = {}) {
  const id = cleanId(listingId);
  if (!id) throw new Error('listing_id inválido.');
  const productId = input.productId == null ? null : cleanId(input.productId);
  const categoryId = input.categoryId == null ? null : cleanId(input.categoryId);
  const platformSkus = Array.isArray(input.platformSkus)
    ? input.platformSkus.map(cleanText).filter(Boolean).slice(0, 100)
    : null;
  return await supabaseRpc(env, 'commerce_resolve_reconciliation_listing_v1', {
    p_listing_id: id,
    p_action: cleanText(input.action),
    p_product_id: productId,
    p_product_name: cleanText(input.productName),
    p_category_id: categoryId,
    p_platform_skus: platformSkus,
    p_apply_family: Boolean(input.applyFamily),
    p_resolve: input.resolve !== false,
    p_operator: cleanText(input.operator)
  });
}


export async function commerceShopeeSnapshot(env, filters = {}) {
  const limit = cleanPageSize(filters.limit, 40);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_shopee_snapshot_v1', {
    p_search: cleanText(filters.search),
    p_match_status: cleanText(filters.status),
    p_limit: limit,
    p_offset: offset
  });
  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}


export async function commerceSalesImportBatches(env, filters = {}) {
  const limit = cleanPageSize(filters.limit, 30);
  const offset = cleanOffset(filters.offset);
  const rows = await supabaseRpc(env, 'commerce_list_sales_imports_v1', {
    p_limit: limit,
    p_offset: offset
  });
  return {
    items: Array.isArray(rows) ? rows : [],
    limit,
    offset
  };
}

export async function commerceCreateSalesImport(env, input = {}) {
  const batchId = await supabaseRpc(env, 'commerce_create_sales_import_v1', {
    p_platform_code: cleanText(input.platform),
    p_source_filename: cleanText(input.filename),
    p_source_sha256: cleanText(input.sha256),
    p_created_by: cleanText(input.createdBy)
  });
  const id = Number(batchId || 0);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Supabase não retornou um batch_id de vendas válido.');
  return id;
}

export async function commerceAppendSalesImportRows(env, batchId, rows = []) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id de vendas inválido.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) {
    throw new Error('Cada lote de vendas deve conter entre 1 e 100 linhas.');
  }
  return Number(await supabaseRpc(env, 'commerce_append_sales_import_rows_v1', {
    p_batch_id: id,
    p_rows: rows
  }, { timeoutMs: 8000 }) || 0);
}

export async function commerceAppendSalesListingDaily(env, batchId, rows = []) {
  const id = cleanId(batchId);
  if (!id || !Array.isArray(rows) || !rows.length || rows.length > 100) {
    throw new Error('Lote de vendas por anúncio inválido.');
  }
  return Number(await supabaseRpc(env, 'commerce_append_sales_listing_daily_v1', {
    p_batch_id:id,
    p_rows:rows
  }, { timeoutMs:8000 }) || 0);
}

export async function commerceAppendShopeeDailySku(env, batchId, rows = []) {
  const id = cleanId(batchId);
  if (!id || !Array.isArray(rows) || !rows.length || rows.length > 100)
    throw new Error('Lote diário Shopee inválido.');
  return Number(await supabaseRpc(env, 'commerce_append_shopee_sku_daily_v1', {
    p_batch_id:id, p_rows:rows
  }, { timeoutMs: 8000 }) || 0);
}

export async function commerceAppendShopeeFinanceDaily(env,batchId,rows=[],sourceSha='') {
  const id=cleanId(batchId);
  if(!id||!Array.isArray(rows)||rows.length<1||rows.length>100)
    throw new Error('Envie de 1 a 100 registros financeiros Shopee por lote.');
  return Number(await supabaseRpc(env,'commerce_append_shopee_finance_daily_v1',{
    p_batch_id:id,p_rows:rows,p_source_sha256:cleanText(sourceSha)||null
  },{timeoutMs:10000})||0);
}

export async function commerceAppendShopeeFinanceMonth(env,batchId,rows=[],sourceSha='') {
  const id=cleanId(batchId);
  if(!id||!Array.isArray(rows)||rows.length<1||rows.length>100)
    throw new Error('Envie de 1 a 100 meses financeiros Shopee por lote.');
  return Number(await supabaseRpc(env,'commerce_append_shopee_finance_month_v1',{
    p_batch_id:id,p_rows:rows,p_source_sha256:cleanText(sourceSha)||null
  },{timeoutMs:10000})||0);
}

export async function commerceShopeeFinanceBackfillSource(env,{filename,sha256}={}) {
  const name=cleanText(filename),sha=cleanText(sha256);
  if(!name||name.length>255||!/^[0-9a-f]{64}$/i.test(sha))
    throw new Error('Nome e SHA-256 do arquivo financeiro são obrigatórios.');
  return await supabaseRpc(env,'commerce_shopee_finance_backfill_source_v1',{
    p_filename:name,p_sha256:sha
  });
}

export async function commerceShopeeFinanceBackfillActivate(env,{batchId,sha256}={}) {
  const id=cleanId(batchId),sha=cleanText(sha256);
  if(!id||!/^[0-9a-f]{64}$/i.test(sha))
    throw new Error('Lote e SHA-256 do arquivo financeiro inválidos.');
  return await supabaseRpc(env,'commerce_shopee_finance_backfill_activate_v1',{
    p_batch_id:id,p_source_sha256:sha
  },{timeoutMs:18000});
}

export async function commerceShopeeListingFinance(env,listingId,{days=30,month=null}={}) {
  const id=cleanId(listingId);
  if(!id)throw new Error('ID do anúncio inválido.');
  const period=String(month||'').trim();
  if(period&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))
    throw new Error('Mês de análise inválido.');
  return await supabaseRpc(env,'commerce_shopee_listing_finance_v1',{
    p_listing_id:id,p_days:[7,30,60,90].includes(Number(days))?Number(days):30,
    p_month:period||null
  },{timeoutMs:10000});
}

export async function commerceAppendSalesImportSummary(env, batchId, rows = []) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id de vendas inválido.');
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) {
    throw new Error('O resumo de vendas deve conter entre 1 e 100 períodos.');
  }
  return Number(await supabaseRpc(env, 'commerce_append_sales_import_summary_v1', {
    p_batch_id: id,
    p_rows: rows
  }, { timeoutMs: 8000 }) || 0);
}

export async function commerceCommitSalesImport(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id de vendas inválido.');
  const result = await supabaseRpc(env, 'commerce_commit_sales_import_v1', {
    p_batch_id: id
  }, { timeoutMs: 20000 });
  if (String(result?.status||'').toUpperCase()==='COMMITTED') {
    await refreshShopeeYearAliases(env);
    try {
      const finance=await supabaseRpc(env,'commerce_activate_shopee_finance_v1',{
        p_batch_id:id
      },{timeoutMs:15000});
      result.finance_status=finance?.status||'UNKNOWN';
      result.finance_months=Number(finance?.finance_months||0);
    } catch(error) {
      // Sales were already committed. Do not retry the sales transaction or
      // report a false sales import failure if only the optional fees failed.
      console.error('[Commerce] Financial Shopee activation pending:',
        String(error?.message||error));
      result.finance_status='NEEDS_REVIEW';
    }
  }
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {};
}

export async function commerceCatalogYearTargets(env, batchId) {
  const id = cleanId(batchId);
  if (!id) throw new Error('batch_id inválido.');
  const rows = await supabaseRpc(env, 'commerce_catalog_year_targets_v1', { p_batch_id: id });
  return { items: Array.isArray(rows) ? rows : [] };
}

export async function commerceCatalogYearDecision(env, rowId, action, actor) {
  const id = cleanId(rowId);
  if (!id || !['REGISTER_PENDING','CONFIRM_PLATFORM'].includes(action)) throw new Error('Decisão PB27 inválida.');
  return supabaseRpc(env, 'commerce_catalog_year_decision_v1', {
    p_import_row_id: id,
    p_action: action,
    p_actor: cleanText(actor)
  });
}
