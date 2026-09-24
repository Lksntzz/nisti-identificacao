export async function commerceApi(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : null;
  if (response.status === 401) {
    window.location.href = '/admin-login';
    throw new Error('Sessão administrativa expirada.');
  }
  if (!response.ok) throw new Error(data?.error || `Erro ${response.status}`);
  return data;
}
