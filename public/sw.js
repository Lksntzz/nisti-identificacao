const CACHE_NAME='nisti-identificacao-v4';
const SHELL_KEY='/__nisti_shell__';

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name!==CACHE_NAME).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET') return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;

  if(url.pathname.startsWith('/api/images/')&&url.searchParams.has('v')){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      const cached=await cache.match(request);
      if(cached) return cached;
      const response=await fetch(request);
      if(response.ok) await cache.put(request,response.clone());
      return response;
    })());
    return;
  }

  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/admin')||url.pathname.startsWith('/admin-login')) return;

  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const response=await fetch(request);
        if(response.ok){
          const cache=await caches.open(CACHE_NAME);
          await cache.put(SHELL_KEY,response.clone());
        }
        return response;
      }catch(error){
        const cached=await caches.match(SHELL_KEY);
        if(cached) return cached;
        throw error;
      }
    })());
    return;
  }

  if(/\.(?:js|css|svg|png|jpg|jpeg|webp|woff2?)$/i.test(url.pathname)){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME);
      const cached=await cache.match(request);
      const network=fetch(request).then(response=>{
        if(response.ok) cache.put(request,response.clone());
        return response;
      }).catch(()=>cached);
      return cached||network;
    })());
  }
});
