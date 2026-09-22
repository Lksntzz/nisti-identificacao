const API_BASE = '/api/admin/commerce';
const CHUNK_SIZE = 100;

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;

  if (response.status === 401) {
    window.location.href = '/admin-login';
    throw new Error('Sessão administrativa expirada.');
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

  onProgress({ phase: 'create', completed: 0, total: rows.length });
  const created = await requestJson(`${API_BASE}/imports`, {
    method: 'POST',
    body: JSON.stringify({
      marketplace: parsedWorkbook.marketplace,
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
      body: JSON.stringify({ rows: chunk })
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
    if (!error?.retryable) throw error;
    const recovered = await recoverBatchAfterRetryableError(batchId, ['PARSED', 'REVIEW', 'COMMITTED'], error);
    finalized = { recovered_after_timeout: true, batch: recovered };
  }

  onProgress({ phase: 'reconcile', completed, total: rows.length, batchId });
  let reconciled;
  try {
    reconciled = await requestJson(`${API_BASE}/imports/${batchId}/reconcile`, {
      method: 'POST',
      body: '{}'
    });
  } catch (error) {
    if (!error?.retryable) throw error;
    const recovered = await recoverBatchAfterRetryableError(batchId, ['REVIEW', 'COMMITTED'], error);
    reconciled = { recovered_after_timeout: true, batch: recovered };
  }

  onProgress({ phase: 'done', completed, total: rows.length, batchId });
  return { batchId, finalized, reconciled };
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
