import readExcelFile from 'read-excel-file/browser';
import { sha256Hex, COMMERCE_XLSX_MAX_BYTES, COMMERCE_XLSX_MAX_ROWS } from './commerce-xlsx-reader.js';

const HEADER_ALIASES = Object.freeze({
  sku_primary: ['sku principal','sku pai','sku do anuncio','sku anuncio','seller sku','sku base'],
  sku: ['sku da variacao','sku variacao','sku do produto','sku produto','sku','codigo do vendedor','código do vendedor'],
  product_name: ['nome do produto','produto','titulo do produto','título do produto','item title','titulo','título'],
  variation: ['variacao','variação','modelo','variation','nome da variacao','nome da variação'],
  units: ['quantidade','qtd','unidades','quantity','quantidade do produto','itens'],
  order_id: ['id do pedido','numero do pedido','número do pedido','pedido','order id','order_id'],
  revenue: ['faturamento','receita do produto','valor do produto','valor total','total do produto','preco total','preço total','receita','subtotal'],
  date: ['data do pedido','data da venda','data de criacao','data de criação','created at','data','horario do pedido','horário do pedido'],
  status: ['status do pedido','situacao do pedido','situação do pedido','status','estado do pedido']
});

const CANCEL_TOKENS = ['cancel', 'cancelado', 'cancelada', 'canceled', 'cancelled', 'reembols', 'refunded', 'devolvid'];

function text(value) {
  return String(value ?? '').trim();
}

function fold(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function cleanPlatform(value) {
  const token = fold(value).replace(/[^a-z0-9]+/g, '_').toUpperCase();
  if (token === 'SHOPEE') return 'SHOPEE';
  if (['ML_NOVO','MERCADO_LIVRE_NOVO','MERCADOLIVRE_NOVO'].includes(token)) return 'ML_NOVO';
  if (['ML_ANTIGO','MERCADO_LIVRE_ANTIGO','MERCADOLIVRE_ANTIGO'].includes(token)) return 'ML_ANTIGO';
  throw new Error('Selecione Shopee, ML Novo ou ML Antigo.');
}

function validateFile(file) {
  if (!(file instanceof Blob)) throw new Error('Selecione um arquivo Excel válido.');
  const filename = text(file.name);
  if (!/\.xlsx$/i.test(filename)) throw new Error('Para vendas, envie uma planilha .xlsx.');
  if (file.size <= 0) throw new Error('O arquivo está vazio.');
  if (file.size > COMMERCE_XLSX_MAX_BYTES) throw new Error('O arquivo excede o limite operacional de 25 MB.');
  return filename;
}

function normalizedHeader(value) {
  return fold(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function aliasIndex(row, aliases) {
  const normalized = row.map(normalizedHeader);
  for (const alias of aliases) {
    const target = normalizedHeader(alias);
    const exact = normalized.findIndex(value => value === target);
    if (exact >= 0) return exact;
  }
  for (const alias of aliases) {
    const target = normalizedHeader(alias);
    const partial = normalized.findIndex(value => value && (value.includes(target) || target.includes(value)));
    if (partial >= 0) return partial;
  }
  return -1;
}

function detectHeader(data) {
  let best = null;
  for (let rowIndex = 0; rowIndex < Math.min(40, data.length); rowIndex += 1) {
    const row = Array.isArray(data[rowIndex]) ? data[rowIndex] : [];
    const columns = {};
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) columns[key] = aliasIndex(row, aliases);
    const score = [
      columns.sku >= 0 || columns.sku_primary >= 0,
      columns.units >= 0,
      columns.revenue >= 0,
      columns.order_id >= 0,
      columns.date >= 0,
      columns.product_name >= 0
    ].filter(Boolean).length;
    if (!best || score > best.score) best = { rowIndex, columns, score };
  }
  if (!best || best.score < 2 || (best.columns.sku < 0 && best.columns.sku_primary < 0)) {
    throw new Error('Não consegui identificar as colunas de vendas. A planilha precisa ter pelo menos SKU e quantidade/pedido/faturamento.');
  }
  return best;
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  let raw = text(value).replace(/R\$|\s/g, '');
  if (!raw) return 0;
  if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(raw)) raw = raw.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d+,\d+$/.test(raw)) raw = raw.replace(',', '.');
  else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(raw)) raw = raw.replace(/,/g, '');
  const result = Number(raw.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(result) ? result : 0;
}

function integerValue(value, fallback = 0) {
  const n = Math.trunc(numberValue(value));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.trunc(value));
    return epoch;
  }
  const raw = text(value);
  if (!raw) return null;
  const br = raw.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
  if (br) return new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1])));
  const iso = raw.match(/\b(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})\b/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthBounds(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  const iso = date => date.toISOString().slice(0, 10);
  return {
    period_key: `${year}-${String(month).padStart(2, '0')}`,
    period_start: iso(start),
    period_end: iso(end)
  };
}

function fallbackBounds(fallbackPeriod) {
  const match = text(fallbackPeriod).match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  return match ? monthBounds(Number(match[1]), Number(match[2])) : null;
}

function boundsForDate(date, fallbackPeriod) {
  if (date) {
    const base = monthBounds(date.getUTCFullYear(), date.getUTCMonth() + 1);
    return { ...base, sale_date: date.toISOString().slice(0, 10) };
  }
  const fallback = fallbackBounds(fallbackPeriod);
  return fallback ? { ...fallback, sale_date: fallback.period_end } : null;
}

function periodBoundsForImport(monthKey, latestSaleDate) {
  const match = String(monthKey || '').match(/^(20\d{2})-(0[1-9]|1[0-2])$/);
  if (!match) return null;
  const full = monthBounds(Number(match[1]), Number(match[2]));
  if (!latestSaleDate || !latestSaleDate.startsWith(monthKey)) return full;

  const fullEndDay = Number(full.period_end.slice(-2));
  const observedDay = Number(latestSaleDate.slice(-2));
  if (!Number.isInteger(observedDay) || observedDay >= fullEndDay) return full;

  return {
    period_key: `${monthKey} (01-${String(observedDay).padStart(2, '0')})`,
    period_start: full.period_start,
    period_end: latestSaleDate
  };
}

function normalizeSku(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function isCancelled(value) {
  const token = fold(value);
  return token && CANCEL_TOKENS.some(part => token.includes(part));
}

function cell(row, index) {
  return index >= 0 ? row?.[index] : null;
}

function maxDate(values) {
  const dates = values.filter(Boolean).map(value => new Date(`${value}T00:00:00Z`));
  if (!dates.length) return null;
  return new Date(Math.max(...dates.map(date => date.getTime()))).toISOString().slice(0, 10);
}

export async function readCommerceSalesXlsx(file, platform, fallbackPeriod = '') {
  const platformCode = cleanPlatform(platform);
  const filename = validateFile(file);
  const buffer = await file.arrayBuffer();
  const [sha256, workbook] = await Promise.all([sha256Hex(buffer), readExcelFile(buffer)]);
  if (!Array.isArray(workbook) || !workbook.length) throw new Error('O arquivo não possui planilhas legíveis.');

  const raw = [];
  const sheetInfo = [];
  let physicalRows = 0;

  for (const sheet of workbook) {
    const data = Array.isArray(sheet?.data) ? sheet.data : [];
    if (!data.length) continue;
    physicalRows += data.length;
    if (physicalRows > COMMERCE_XLSX_MAX_ROWS) {
      throw new Error(`O arquivo excede o limite de ${COMMERCE_XLSX_MAX_ROWS.toLocaleString('pt-BR')} linhas.`);
    }

    let header;
    try {
      header = detectHeader(data);
    } catch {
      continue;
    }

    let accepted = 0;
    let ignored = 0;
    for (let rowIndex = header.rowIndex + 1; rowIndex < data.length; rowIndex += 1) {
      const row = Array.isArray(data[rowIndex]) ? data[rowIndex] : [];
      if (!row.some(value => text(value))) continue;
      if (header.columns.status >= 0 && isCancelled(cell(row, header.columns.status))) {
        ignored += 1;
        continue;
      }

      const sku = text(cell(row, header.columns.sku)) || text(cell(row, header.columns.sku_primary));
      if (!sku) {
        ignored += 1;
        continue;
      }
      const skuPrimary = text(cell(row, header.columns.sku_primary)) || sku;
      const orderId = text(cell(row, header.columns.order_id)) || `ROW:${sheet?.sheet || 'Sheet'}:${rowIndex + 1}`;
      const date = parseDateValue(cell(row, header.columns.date));
      const bounds = boundsForDate(date, fallbackPeriod);
      if (!bounds) {
        throw new Error('A planilha não possui uma data reconhecível. Informe o mês de referência antes de importar.');
      }

      const units = header.columns.units >= 0 ? Math.max(1, integerValue(cell(row, header.columns.units), 1)) : 1;
      raw.push({
        source_row_number: rowIndex + 1,
        month_key: bounds.period_key,
        sale_date: bounds.sale_date,
        sku_primary: skuPrimary,
        sku,
        sku_norm: normalizeSku(sku),
        product_name: text(cell(row, header.columns.product_name)) || null,
        variation: text(cell(row, header.columns.variation)) || null,
        units,
        order_id: orderId,
        product_revenue: Math.max(0, numberValue(cell(row, header.columns.revenue)))
      });
      accepted += 1;
    }

    sheetInfo.push({
      name: text(sheet?.sheet) || 'Sem nome',
      physical_rows: data.length,
      accepted_rows: accepted,
      ignored_rows: ignored
    });
  }

  if (!raw.length) throw new Error('Nenhuma venda válida foi encontrada no arquivo.');

  const latestSaleDate = maxDate(raw.map(item => item.sale_date));
  const periodMap = new Map(
    [...new Set(raw.map(item => item.month_key))].map(monthKey => [
      monthKey,
      periodBoundsForImport(monthKey, latestSaleDate)
    ])
  );

  const grouped = new Map();
  for (const item of raw) {
    const period = periodMap.get(item.month_key);
    const key = [period.period_key, item.sku_primary, item.sku].join('|');
    const group = grouped.get(key) || {
      source_row_number: grouped.size + 1,
      period_key: period.period_key,
      period_start: period.period_start,
      period_end: period.period_end,
      sku_primary: item.sku_primary,
      sku: item.sku,
      sku_norm: item.sku_norm,
      product_name: item.product_name,
      variation: item.variation,
      units: 0,
      orders: new Set(),
      product_revenue: 0
    };
    group.units += item.units;
    group.orders.add(item.order_id);
    group.product_revenue += item.product_revenue;
    if (!group.product_name && item.product_name) group.product_name = item.product_name;
    if (!group.variation && item.variation) group.variation = item.variation;
    grouped.set(key, group);
  }

  const rows = [...grouped.values()].map(group => ({
    source_row_number: group.source_row_number,
    period_key: group.period_key,
    period_start: group.period_start,
    period_end: group.period_end,
    sku_primary: group.sku_primary || null,
    sku: group.sku,
    sku_norm: group.sku_norm,
    product_name: group.product_name || null,
    variation: group.variation || null,
    units: group.units,
    orders_with_item: group.orders.size,
    product_revenue: Number(group.product_revenue.toFixed(2))
  }));

  const summaryMap = new Map();
  for (const item of raw) {
    const period = periodMap.get(item.month_key);
    const summary = summaryMap.get(period.period_key) || {
      period_key: period.period_key,
      period_start: period.period_start,
      period_end: period.period_end,
      orders: new Set(),
      units: 0,
      product_revenue: 0,
      listings: new Set(),
      skus: new Set()
    };
    summary.orders.add(item.order_id);
    summary.units += item.units;
    summary.product_revenue += item.product_revenue;
    summary.listings.add(item.sku_primary || item.sku);
    summary.skus.add(item.sku_norm);
    summaryMap.set(period.period_key, summary);
  }

  const summaries = [...summaryMap.values()].map(summary => ({
    period_key: summary.period_key,
    period_start: summary.period_start,
    period_end: summary.period_end,
    net_orders: summary.orders.size,
    units: summary.units,
    product_revenue: Number(summary.product_revenue.toFixed(2)),
    listings_with_sales: summary.listings.size,
    skus_with_sales: summary.skus.size
  })).sort((a, b) => a.period_start.localeCompare(b.period_start));

  return {
    filename,
    sha256,
    size_bytes: file.size,
    platform_code: platformCode,
    rows,
    summaries,
    sheets: sheetInfo,
    data_through: maxDate(summaries.map(item => item.period_end)),
    summary: {
      physical_rows: physicalRows,
      accepted_sales_rows: raw.length,
      aggregated_rows: rows.length,
      period_count: summaries.length,
      units: summaries.reduce((sum, item) => sum + item.units, 0),
      net_orders: summaries.reduce((sum, item) => sum + item.net_orders, 0),
      product_revenue: Number(summaries.reduce((sum, item) => sum + item.product_revenue, 0).toFixed(2))
    }
  };
}

export const commerceSalesImportInternals = Object.freeze({
  detectHeader,
  numberValue,
  parseDateValue,
  normalizeSku,
  isCancelled,
  monthBounds
});
