const API_BASE = '/api/admin/commerce';
const CHUNK_SIZE = 100;

// Replays only idempotent staging inserts after HTTP 429; finalization is never retried.
async function requestJson(path, options = {}) {
  const { retryRateLimit = false, ...fetchOptions } = options;
  const maxRetries = retryRateLimit ? 4 : 0;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...(fetchOptions.headers || {})
      },
      ...fetchOptions
    });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : null;
    if (response.status === 401) {
      window.location.href = '/admin-login';
      throw new Error('Sessão administrativa expirada.');
    }
    if (response.status === 429 && attempt < maxRetries) {
      const retrySeconds = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retrySeconds) && retrySeconds > 0
        ? Math.min(60000, Math.ceil(retrySeconds * 1000))
        : [2000, 5000, 12000, 25000][attempt];
      await wait(delay);
      continue;
    }
    if (!response.ok) {
      const error = new Error(data?.error || `Erro ${response.status}`);
      error.status = response.status;
      error.technicalError = data?.technical_error || null;
      error.retryable = Boolean(data?.retryable);
      throw error;
    }
    return data;
  }
}

function chunks(rows, size = CHUNK_SIZE) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function recoverBatchAfterRetryableError(batchId, expectedStatuses, originalError) {
  const delays = [250, 750, 1500, 2500];
  for (const delay of delays) {
    await wait(delay);
    try {
      const batch = await getCommerceImport(batchId);
      if (expectedStatuses.includes(String(batch?.status || '').toUpperCase())) {
        return batch;
      }
    } catch {
      // A confirmação é best-effort. Preservamos o erro original se o estado não puder ser confirmado.
    }
  }
  throw originalError;
}

export async function listCommerceImports({ limit = 30, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return requestJson(`${API_BASE}/imports?${params}`);
}

export async function deleteCommerceImport(batchId) {
  return requestJson(`${API_BASE}/imports/${Number(batchId)}`, { method: 'DELETE' });
}

export async function getCommerceImport(batchId) {
  return requestJson(`${API_BASE}/imports/${Number(batchId)}`);
}

export async function getCommerceImportRows(batchId, { status = '', limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) params.set('status', status);
  return requestJson(`${API_BASE}/imports/${Number(batchId)}/rows?${params}`);
}

export async function stageCommerceWorkbook(parsedWorkbook, onProgress = () => {}) {
  const rows = Array.isArray(parsedWorkbook?.rows) ? parsedWorkbook.rows : [];
  if (!parsedWorkbook?.marketplace || !parsedWorkbook?.filename || !parsedWorkbook?.sha256 || !rows.length) {
    throw new Error('Workbook normalizado incompleto.');
  }

  if (parsedWorkbook.marketplace === 'MERCADO_LIVRE' && !['ANTIGO','NOVO'].includes(parsedWorkbook.account_code)) {
    throw new Error('Conta do Mercado Livre não selecionada.');
  }

  onProgress({ phase: 'create', completed: 0, total: rows.length });
  const created = await requestJson(`${API_BASE}/imports`, {
    method: 'POST',
    body: JSON.stringify({
      marketplace: parsedWorkbook.marketplace,
      account_code: parsedWorkbook.account_code || null,
      filename: parsedWorkbook.filename,
      sha256: parsedWorkbook.sha256
    })
  });
  const batchId = Number(created?.batch_id || 0);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) throw new Error('A API não retornou um batch_id válido.');

  let completed = 0;
  const rowChunks = chunks(rows);
  for (let index = 0; index < rowChunks.length; index += 1) {
    const chunk = rowChunks[index];
    onProgress({ phase: 'upload', completed, total: rows.length, chunk: index + 1, chunks: rowChunks.length, batchId });
    await requestJson(`${API_BASE}/imports/${batchId}/rows`, {
      method: 'POST',
      body: JSON.stringify({ rows: chunk }),
      retryRateLimit: true
    });
    completed += chunk.length;
  }

  onProgress({ phase: 'finalize', completed, total: rows.length, batchId });
  let finalized;
  try {
    finalized = await requestJson(`${API_BASE}/imports/${batchId}/finalize`, {
      method: 'POST',
      body: '{}'
    });
  } catch (error) {
    if (!error?.retryable) {
      error.batchId = batchId;
      error.stage = 'finalize';
      throw error;
    }
    try {
      const recovered = await recoverBatchAfterRetryableError(batchId, ['PARSED', 'REVIEW', 'COMMITTED'], error);
      finalized = { recovered_after_timeout: true, batch: recovered };
    } catch (recoveryError) {
      recoveryError.batchId = batchId;
      recoveryError.stage = 'finalize';
      throw recoveryError;
    }
  }

  onProgress({ phase: 'reconcile', completed, total: rows.length, batchId });
  let reconciled;
  try {
    reconciled = await requestJson(`${API_BASE}/imports/${batchId}/reconcile`, {
      method: 'POST',
      body: '{}'
    });
  } catch (error) {
    if (!error?.retryable) {
      error.batchId = batchId;
      error.stage = 'reconcile';
      throw error;
    }
    try {
      const recovered = await recoverBatchAfterRetryableError(batchId, ['REVIEW', 'COMMITTED'], error);
      reconciled = { recovered_after_timeout: true, batch: recovered };
    } catch (recoveryError) {
      recoveryError.batchId = batchId;
      recoveryError.stage = 'reconcile';
      throw recoveryError;
    }
  }

  onProgress({ phase: 'done', completed, total: rows.length, batchId });
  return { batchId, finalized, reconciled };
}

export async function retryCommerceImportReconciliation(batchId) {
  const id = Number(batchId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Lote inválido para retomar.');
  return requestJson(`${API_BASE}/imports/${id}/reconcile`, {
    method: 'POST', body: '{}'
  });
}

export async function decideCommerceImportRow(rowId, action, productId = null) {
  return requestJson(`${API_BASE}/import-rows/${Number(rowId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({ action, product_id: productId })
  });
}

export async function approveCommerceNewRows(batchId) {
  return requestJson(`${API_BASE}/imports/${Number(batchId)}/approve-new`, {
    method: 'POST',
    body: '{}'
  });
}

export async function approveCommerceProbableRows(batchId) {
  return requestJson(`${API_BASE}/imports/${Number(batchId)}/approve-probable`, {
    method: 'POST',
    body: '{}'
  });
}

export async function syncCommerceListingStatuses(batchId) {
  return requestJson(`${API_BASE}/imports/${Number(batchId)}/sync-listing-statuses`, {
    method: 'POST',
    body: '{}'
  });
}

export async function commitCommerceImport(batchId) {
  try {
    return await requestJson(`${API_BASE}/imports/${Number(batchId)}/commit`, {
      method: 'POST',
      body: '{}'
    });
  } catch (error) {
    if (!error?.retryable) throw error;
    const recovered = await recoverBatchAfterRetryableError(Number(batchId), ['COMMITTED'], error);
    return { recovered_after_timeout: true, batch: recovered };
  }
}


export async function listCommerceSalesImports({ limit = 30, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return requestJson(`${API_BASE}/sales/imports?${params}`);
}

export async function stageCommerceSalesWorkbook(parsedWorkbook, onProgress = () => {}) {
  const rows = Array.isArray(parsedWorkbook?.rows) ? parsedWorkbook.rows : [];
  const summaries = Array.isArray(parsedWorkbook?.summaries) ? parsedWorkbook.summaries : [];
  const listingRows = Array.isArray(parsedWorkbook?.listing_rows) ? parsedWorkbook.listing_rows : [];
  const dailySkuRows = Array.isArray(parsedWorkbook?.sku_daily_rows) ? parsedWorkbook.sku_daily_rows : [];
  const financeDaily=Array.isArray(parsedWorkbook?.finance_daily_rows)?parsedWorkbook.finance_daily_rows:[];
  const financeMonths=Array.isArray(parsedWorkbook?.finance_month_rows)?parsedWorkbook.finance_month_rows:[];
  if (!parsedWorkbook?.platform_code || !parsedWorkbook?.filename || !parsedWorkbook?.sha256 || !rows.length) {
    throw new Error('Arquivo de vendas normalizado incompleto.');
  }

  onProgress({ phase: 'create', completed: 0, total: rows.length });
  const created = await requestJson(`${API_BASE}/sales/imports`, {
    method: 'POST',
    body: JSON.stringify({
      platform: parsedWorkbook.platform_code,
      filename: parsedWorkbook.filename,
      sha256: parsedWorkbook.sha256
    })
  });
  const batchId = Number(created?.batch_id || 0);
  if (!Number.isSafeInteger(batchId) || batchId <= 0) throw new Error('A API não retornou um batch_id de vendas válido.');

  let completed = 0;
  const rowChunks = chunks(rows);
  for (let index = 0; index < rowChunks.length; index += 1) {
    const chunk = rowChunks[index];
    onProgress({
      phase: 'upload',
      completed,
      total: rows.length,
      chunk: index + 1,
      chunks: rowChunks.length,
      batchId
    });
    await requestJson(`${API_BASE}/sales/imports/${batchId}/rows`, {
      method: 'POST',
      body: JSON.stringify({ rows: chunk }),
      retryRateLimit: true
    });
    completed += chunk.length;
  }

  if (summaries.length) {
    onProgress({ phase: 'summary', completed, total: rows.length, batchId });
    for (const chunk of chunks(summaries)) {
      await requestJson(`${API_BASE}/sales/imports/${batchId}/summary`, {
        method: 'POST',
        body: JSON.stringify({ rows: chunk }),
      retryRateLimit: true
      });
    }
  }

  // Save true listing-ID performance before activating the snapshot. Never
  // infer individual advertisement sales from SKU-level totals.
  if (listingRows.length) {
    onProgress({phase:'listings',completed,total:rows.length,batchId});
    for (const chunk of chunks(listingRows)) {
      await requestJson(`${API_BASE}/sales/imports/${batchId}/listing-daily`, {
        method:'POST',
        body:JSON.stringify({rows:chunk}),
      retryRateLimit: true
      });
    }
  }

  // Shopee has no listing ID in its orders report. Stage dated SKU totals,
  // and let the database resolve only unique active SKU owners.
  if (parsedWorkbook.platform_code === 'SHOPEE' && dailySkuRows.length) {
    onProgress({phase:'daily-sku',completed,total:rows.length,batchId});
    for (const chunk of chunks(dailySkuRows)) {
      await requestJson(`${API_BASE}/sales/imports/${batchId}/sku-daily`, {
        method:'POST',
        body:JSON.stringify({rows:chunk}),
        retryRateLimit:true
      });
    }
  }

  // Import only aggregated finances: no buyer data or order identifiers leave
  // the browser, and no per-variation fees are allocated for multi-SKU orders.
  if(parsedWorkbook.platform_code==='SHOPEE'&&financeMonths.length){
    onProgress({phase:'finance',completed,total:rows.length,batchId});
    for(const chunk of chunks(financeMonths)){
      await requestJson(`${API_BASE}/sales/imports/${batchId}/finance-month`,{
        method:'POST',body:JSON.stringify({rows:chunk}),retryRateLimit:true
      });
    }
    for(const chunk of chunks(financeDaily)){
      await requestJson(`${API_BASE}/sales/imports/${batchId}/finance-daily`,{
        method:'POST',body:JSON.stringify({rows:chunk}),retryRateLimit:true
      });
    }
  }

  onProgress({ phase: 'commit', completed, total: rows.length, batchId });
  let result;
  try {
    result = await requestJson(`${API_BASE}/sales/imports/${batchId}/commit`, {
      method: 'POST',
      body: '{}'
    });
  } catch (error) {
    if (!error?.retryable) throw error;
    // A timeout can happen after the transaction commits. Read the saved
    // batch status before deciding to retry; never blindly commit twice.
    let recovered = null;
    for (const delay of [250, 750, 1500, 2500]) {
      await wait(delay);
      try {
        const history = await listCommerceSalesImports({ limit: 100 });
        const batch = history.items?.find(item => Number(item.id) === batchId);
        if (batch?.status === 'COMMITTED') {
          recovered = batch;
          break;
        }
      } catch {
        // Preserve the original error if the confirmation read also fails.
      }
    }
    if (!recovered) throw error;
    result = { recovered_after_timeout: true, snapshot_id: recovered.snapshot_id };
  }

  onProgress({ phase: 'done', completed, total: rows.length, batchId });
  return { batchId, result };
}

// Recover financial columns from an *identical* previously imported XLSX.
// This path never creates a sales snapshot or rewrites item quantities.
export async function reprocessShopeeSalesFinance(parsedWorkbook,onProgress=()=>{}){
  const months=Array.isArray(parsedWorkbook?.finance_month_rows)?parsedWorkbook.finance_month_rows:[];
  const daily=Array.isArray(parsedWorkbook?.finance_daily_rows)?parsedWorkbook.finance_daily_rows:[];
  if(parsedWorkbook?.platform_code!=='SHOPEE'||!months.length)
    throw new Error('O arquivo não contém taxas Shopee verificáveis para reprocessar.');
  const sha=String(parsedWorkbook.sha256||'');
  const source=await requestJson(`${API_BASE}/sales/finance/source`,{
    method:'POST',body:JSON.stringify({
      filename:parsedWorkbook.filename,sha256:sha
    })
  });
  const id=Number(source?.batch_id||0);
  if(!Number.isSafeInteger(id)||id<=0)
    throw new Error('Este arquivo não coincide com o Excel original de uma importação confirmada.');
  onProgress({phase:'finance',completed:0,total:daily.length,batchId:id});
  for(const chunk of chunks(months)){
    await requestJson(`${API_BASE}/sales/imports/${id}/finance-month`,{
      method:'POST',body:JSON.stringify({rows:chunk,sha256:sha}),retryRateLimit:true
    });
  }
  let completed=0;
  for(const chunk of chunks(daily)){
    await requestJson(`${API_BASE}/sales/imports/${id}/finance-daily`,{
      method:'POST',body:JSON.stringify({rows:chunk,sha256:sha}),retryRateLimit:true
    });
    completed+=chunk.length;
    onProgress({phase:'finance',completed,total:daily.length,batchId:id});
  }
  const result=await requestJson(`${API_BASE}/sales/finance/activate`,{
    method:'POST',body:JSON.stringify({batch_id:id,sha256:sha})
  });
  return {batchId:id,result};
}

export async function getCommerceCatalogYearTargets(batchId) {
  return requestJson(`${API_BASE}/imports/${Number(batchId)}/year-targets`);
}

export async function decideCommerceCatalogYear(rowId, action) {
  if (!['REGISTER_PENDING', 'CONFIRM_PLATFORM'].includes(action)) throw new Error('Ação PB27 inválida.');
  return requestJson(`${API_BASE}/import-rows/${Number(rowId)}/year-decision`, {
    method: 'POST',
    body: JSON.stringify({ action })
  });
}
