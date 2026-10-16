// Leitor específico da exportação oficial Shopee > Edição em massa > sales_info.
// Os campos técnicos da primeira linha são a fonte de verdade para os índices.
const COLUMNS = Object.freeze([
  'et_title_product_id', 'et_title_product_name',
  'et_title_variation_id', 'et_title_variation_name',
  'et_title_parent_sku', 'et_title_variation_sku',
  'et_title_variation_price', 'ps_gtin_code',
  'et_title_variation_stock'
]);
const FORMAT = 'SHOPEE_SALES_INFO';
const clean = value => String(value ?? '').trim();
const digits = value => /^\d+$/.test(clean(value));

export function looksLikeShopeeSalesInfo(data) {
  const head = Array.isArray(data?.[0]) ? data[0].map(clean) : [];
  return head.includes('et_title_product_id') || head.includes('et_title_variation_id');
}

export function detectShopeeSalesInfo(data) {
  if (!looksLikeShopeeSalesInfo(data)) return false;
  const first = data[0].map(clean);
  if (new Set(first).size !== first.length || COLUMNS.some(column => !first.includes(column))) {
    throw new Error('Planilha Shopee de edição em massa incompleta: faltam colunas técnicas obrigatórias.');
  }
  if (clean(data?.[1]?.[0]) !== 'sales_info') {
    throw new Error('O arquivo Shopee não contém os metadados sales_info esperados.');
  }
  const shopId = clean(data?.[1]?.[3]);
  if (!digits(shopId) || shopId === '0') {
    throw new Error('ID da loja Shopee ausente ou inválido nos metadados do arquivo.');
  }
  // Linha 3 contém títulos traduzidos; linhas 4-6 são instruções e nunca produtos.
  if (clean(data?.[2]?.[first.indexOf('et_title_product_id')]) !== 'ID do Produto') {
    throw new Error('Cabeçalho de produtos Shopee não reconhecido.');
  }
  return true;
}

function categoryFromTitle(title) {
  const name = clean(title).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/caderneta.*vacina/.test(name)) return 'Caderneta de Vacinação';
  if (/\bplanner\b/.test(name)) return 'Planner';
  if (/\bagenda\b/.test(name)) return 'Agenda';
  if (/\bcaderno\b|\brefil\b/.test(name)) return 'Caderno';
  if (/\blivro.*colorir\b/.test(name)) return 'Livro de colorir';
  if (/\betiqueta\b|\badesivo\b/.test(name)) return 'Adesivos / Etiquetas';
  return 'Outros';
}

function yearFrom(...values) {
  for (const value of values) {
    const match = clean(value).match(/\b(20(?:2[0-9]|3[0-9]))\b/);
    if (match) return Number(match[1]);
  }
  return null;
}

export function parseShopeeSalesInfo(data, sheetName) {
  if (!detectShopeeSalesInfo(data)) throw new Error('Arquivo não é uma exportação sales_info da Shopee.');
  const indexes = Object.fromEntries(data[0].map((value,index) => [clean(value),index]));
  const cell = (row,key) => clean(row?.[indexes[key]]);
  const shopId = clean(data[1][3]);
  const records = [];
  const counts = new Map();
  const parents = new Map();

  for (let idx = 6; idx < data.length; idx++) {
    const original = Array.isArray(data[idx]) ? data[idx] : [];
    if (!original.some(value => clean(value))) continue;
    const listingId = cell(original,'et_title_product_id');
    if (!digits(listingId) || listingId === '0') {
      // Preserve malformed rows for manual review, never invent a listing ID.
      records.push({original,rowNumber:idx+1,listingId:'',variationId:'',malformed:true});
      continue;
    }
    const variationId = cell(original,'et_title_variation_id');
    const parentSku = cell(original,'et_title_parent_sku');
    counts.set(listingId,(counts.get(listingId)||0)+1);
    if (parentSku) {
      const parent = parents.get(listingId);
      if (parent && parent !== parentSku) parents.set(listingId,null);
      else if (parent === undefined) parents.set(listingId,parentSku);
    }
    records.push({original,rowNumber:idx+1,listingId,variationId,malformed:false});
  }
  if (!records.length) throw new Error('Exportação Shopee sem linhas de produtos.');
  const keys = new Set();
  const rows = records.map(item => {
    const {original,rowNumber,listingId,variationId,malformed} = item;
    const title = cell(original,'et_title_product_name');
    const variationSku = cell(original,'et_title_variation_sku');
    const parentSku = parents.get(listingId) || '';
    // SKU pai identifica um anúncio, NÃO uma variação. A exceção segura
    // é um anúncio com uma única linha/variação.
    const safeSku = variationSku || (counts.get(listingId)===1 ? parentSku : '');
    const issues = [];
    if (malformed) issues.push('invalid_shopee_listing_id');
    if (!digits(variationId) || variationId === '0') issues.push('invalid_shopee_variation_id');
    const variationKey = listingId && variationId ? listingId+':'+variationId : '';
    if (variationKey && keys.has(variationKey)) issues.push('duplicate_shopee_variation_id');
    if (variationKey) keys.add(variationKey);
    if (!safeSku) issues.push('missing_variation_sku');
    if (!title) issues.push('missing_product_name');
    if (parents.has(listingId) && parents.get(listingId)===null) issues.push('inconsistent_parent_sku');
    const listingUrl = listingId
      ? 'https://shopee.com.br/product/'+shopId+'/'+listingId
      : null;
    const ean = cell(original,'ps_gtin_code');
    const normalized = {
      source_sheet:clean(sheetName)||'Shopee',
      source_row_number:rowNumber,
      marketplace:'SHOPEE',
      source_export_kind:FORMAT,
      source_account_id:shopId,
      sku_primary:safeSku||null,
      sku_secondary:null,
      source_parent_sku:parentSku||null,
      product_name:title||null,
      category:categoryFromTitle(title),
      update_hint:'UNKNOWN',
      source_update_hint:'UNKNOWN',
      // O Excel não informa o status. Só a confirmação explícita do operador
      // permite converter esta observação em ACTIVE antes do envio.
      source_listing_status:'UNKNOWN',
      listing_presence_hint:listingId?'LISTED':'UNKNOWN',
      video_status:'UNKNOWN',
      listing_ref:listingUrl,
      listing_url:listingUrl,
      external_listing_id:listingId||null,
      source_variation_id:digits(variationId)?variationId:null,
      source_variation:cell(original,'et_title_variation_name')||null,
      source_price:cell(original,'et_title_variation_price')||null,
      source_stock:cell(original,'et_title_variation_stock')||null,
      source_ean:ean && ean!=='00'?ean:null,
      observed_year:yearFrom(safeSku,title),
      notes:[]
    };
    return {
      sheet_name:clean(sheetName)||'Shopee',
      row_number:rowNumber,
      parser_status:issues.length?'INVALID':'READY',
      issues,
      original:original.map(value=>value==null?null:value instanceof Date?value.toISOString():value),
      normalized
    };
  });

  return {
    format:FORMAT,source_account_id:shopId,rows,
    summary:{
      listing_count:counts.size,
      variation_count:records.length,
      missing_sku_rows:rows.filter(row=>!row.normalized?.sku_primary).length
    }
  };
}

export function attestShopeeActiveExport(workbook) {
  if (workbook?.format !== FORMAT || !digits(workbook.source_account_id)) {
    throw new Error('Confirmação de anúncios ativos aplicável apenas ao arquivo oficial Shopee.');
  }
  return {
    ...workbook,
    rows:workbook.rows.map(row=>({
      ...row,
      normalized:row.normalized ? {
        ...row.normalized,
        source_listing_status:row.normalized.external_listing_id?'ACTIVE':'UNKNOWN',
        source_status_evidence:'OPERATOR_CONFIRMED_ACTIVE_EXPORT'
      } : null
    }))
  };
}
