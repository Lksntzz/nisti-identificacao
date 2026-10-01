const SUPABASE_FUNCTION_BASE = 'https://yioetdcbgorunwgwuawg.supabase.co/functions/v1/operator-read';

function directResource(path) {
  const url = new URL(path, 'https://nisti.local');
  if (url.pathname === '/api/notifications') return 'notifications';
  if (url.pathname === '/api/notifications/unread-count') return 'notifications-unread';
  if (url.pathname === '/api/mural/unread-count') return 'mural-unread';
  return null;
}

export function supportsDirectOperatorRead(path, options = {}) {
  return String(options.method || 'GET').toUpperCase() === 'GET' && Boolean(directResource(path));
}

export async function directOperatorRead(path, { headers = {}, signal } = {}) {
  const resource = directResource(path);
  if (!resource) return null;

  const sourceUrl = new URL(path, 'https://nisti.local');
  const target = new URL(SUPABASE_FUNCTION_BASE);
  target.searchParams.set('resource', resource);
  for (const [key, value] of sourceUrl.searchParams.entries()) target.searchParams.set(key, value);

  const response = await fetch(target.toString(), {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...(headers['x-user-id'] ? { 'x-user-id': headers['x-user-id'] } : {})
    },
    cache: 'no-store',
    signal
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error || `Erro ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
