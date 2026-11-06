// Verifica a versão publicada sem interferir nas chamadas de expedição.
export const MONITOR_BUILD_CHECK_INTERVAL_MS=60_000;
export const MONITOR_MIN_IDLE_BEFORE_RELOAD_MS=15_000;

export async function fetchPublishedMonitorBuild(fetchFn=fetch){
  try{
    const response=await fetchFn('/monitor-build.json?check='+Date.now(),{
      method:'GET',
      cache:'no-store',
      credentials:'same-origin'
    });
    if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))return null;
    const data=await response.json();
    return typeof data?.id==='string'&&/^[a-zA-Z0-9._-]{8,100}$/.test(data.id)?data.id:null;
  }catch{
    // Sem internet, nenhuma atualização interrompe o monitor.
    return null;
  }
}

export function shouldReloadMonitor({updateReady,online,paired,activeCall,pending,idleMs}){
  return updateReady===true&&online===true&&paired===true
    &&!activeCall&&pending===0&&idleMs>=MONITOR_MIN_IDLE_BEFORE_RELOAD_MS;
}
