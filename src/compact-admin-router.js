import edgeRouter from './edge-router.js';

function redirectedResponse(response, location) {
  const headers = new Headers(response.headers);
  headers.set('location', location);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/admin' && request.method === 'GET') {
      const sessionUrl = new URL('/api/admin/session', url);
      const sessionRequest = new Request(sessionUrl.toString(), {
        method: 'GET',
        headers: request.headers
      });
      const session = await edgeRouter.fetch(sessionRequest, env, ctx);
      if (!session.ok) return Response.redirect(new URL('/admin-login', url), 302);

      const assetUrl = new URL('/', url);
      return env.ASSETS.fetch(new Request(assetUrl.toString(), {
        method: 'GET',
        headers: request.headers
      }));
    }

    const response = await edgeRouter.fetch(request, env, ctx);
    const location = response.headers.get('location');
    if (!location) return response;

    let target;
    try {
      target = new URL(location, url);
    } catch {
      return response;
    }

    if (target.pathname === '/' && target.searchParams.get('nisti_admin') === '1') {
      return redirectedResponse(response, new URL('/admin', url).toString());
    }

    return response;
  }
};
