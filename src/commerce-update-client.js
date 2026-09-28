const BASE = '/api/admin/commerce/update-campaigns';

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
    error.technicalError = data?.technical_error || null;
    throw error;
  }
  return data;
}

export async function listUpdateCampaigns({ limit = 30, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return requestJson(`${BASE}?${params}`);
}

export async function createUpdateCampaign({ name, sourceYear, targetYear }) {
  return requestJson(BASE, {
    method: 'POST',
    body: JSON.stringify({ name, source_year: Number(sourceYear), target_year: Number(targetYear) })
  });
}

export async function listUpdateItems(campaignId, { status = '', marketplace = '', search = '', limit = 50, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) params.set('status', status);
  if (marketplace) params.set('marketplace', marketplace);
  if (search.trim()) params.set('search', search.trim());
  return requestJson(`${BASE}/${Number(campaignId)}/items?${params}`);
}

export async function getUpdateItem(itemId) {
  return requestJson(`${BASE}/items/${Number(itemId)}`);
}

export async function setUpdateCheck(checkId, input) {
  return requestJson(`${BASE}/checks/${Number(checkId)}`, {
    method: 'POST',
    body: JSON.stringify({
      status: input.status,
      detected_value: input.detectedValue || null,
      expected_value: input.expectedValue || null,
      notes: input.notes || null
    })
  });
}

export async function closeUpdateCampaign(campaignId) {
  return requestJson(`${BASE}/${Number(campaignId)}/close`, {
    method: 'POST',
    body: '{}'
  });
}
