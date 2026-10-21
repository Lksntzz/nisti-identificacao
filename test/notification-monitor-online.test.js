import test from 'node:test';
import assert from 'node:assert/strict';
import { DISPATCH_PLATFORMS } from '../src/notification-dispatch-options.js';
import { DISPATCH_SOUND_PATTERNS,DISPATCH_SOUND_DURATION_SECONDS,notificationSoundNotes,playNotificationSound,stopNotificationSound,missingSoundPlatforms } from '../src/notification-platform-sounds.js';
import { fetchPublishedMonitorBuild,shouldReloadMonitor,MONITOR_BUILD_CHECK_INTERVAL_MS } from '../src/notification-monitor-updates.js';
import fs from 'node:fs';

test('all 10 marketplace queues have distinct sound profiles and valid notes',()=>{
  assert.deepEqual(missingSoundPlatforms(),[]);
  assert.equal(Object.keys(DISPATCH_SOUND_PATTERNS).length,DISPATCH_PLATFORMS.length);
  const signatures=new Set();
  for(const platform of DISPATCH_PLATFORMS){
    const p=DISPATCH_SOUND_PATTERNS[platform];
    assert.ok(['sine','square','triangle'].includes(p.wave));
    assert.ok(p.notes.length>=3&&p.notes.length<=5,platform);
    const sig=JSON.stringify(p);
    assert.ok(!signatures.has(sig),'Som repetido: '+platform);
    signatures.add(sig);
    let prior=-1;
    for(const [hz,delay,duration] of p.notes){
      assert.ok(hz>=400&&hz<=1400,platform);
      assert.ok(delay>prior&&delay>=0,platform);
      assert.ok(duration>=0.09&&duration<=0.35,platform);
      prior=delay;
    }
  }
});

test('chime plays only in running audio context',()=>{
  let starts=0,stops=0;
  const ctx={state:'suspended',currentTime:2,destination:{},
    createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){starts++},stop(){stops++}};},
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  };
  assert.equal(playNotificationSound(ctx,'SHOPEE'),false);
  assert.equal(starts,0);
  ctx.state='running';
  assert.equal(playNotificationSound(ctx,'SHOPEE'),true);
  assert.equal(starts,notificationSoundNotes('SHOPEE').length);
  assert.equal(stops,starts);
});

test('all platform chimes repeat for at most 13 seconds',()=>{
  assert.equal(DISPATCH_SOUND_DURATION_SECONDS,13);
  for(const platform of DISPATCH_PLATFORMS){
    const events=notificationSoundNotes(platform,13);
    assert.ok(events.length>DISPATCH_SOUND_PATTERNS[platform].notes.length,platform);
    assert.ok(events[events.length-1].begin>10,platform);
    assert.ok(events.every(note=>note.begin>=0&&note.duration>=0.065&&note.begin+note.duration<=13.00001),platform);
    assert.deepEqual(notificationSoundNotes(platform,0),[]);
    const shortened=notificationSoundNotes(platform,3.25);
    assert.ok(shortened.every(note=>note.begin+note.duration<=3.25001),platform);
    assert.equal(notificationSoundNotes(platform,99).length,events.length);
  }
});

test('a new call stops scheduled audio; no notes extend past the 13-second limit',()=>{
  const starts=[],stops=[];
  const ctx={state:'running',currentTime:50,destination:{},
    createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(t){starts.push(t)},stop(t){stops.push(t)}}},
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}}}
  };
  assert.equal(playNotificationSound(ctx,'AMAZON',13),true);
  assert.ok(starts.length>10);
  assert.ok(Math.max(...stops)<=63.00801);
  const oldCount=stops.length;
  assert.equal(playNotificationSound(ctx,'SHEIN',2),true);
  assert.ok(stops.length>oldCount,'prior call cancelled');
  const count=stops.length;
  stopNotificationSound(ctx);
  assert.ok(stops.length>count,'current call can be stopped');
  assert.equal(playNotificationSound(ctx,'AMAZON',0),false);
});

test('monitor build check avoids service-worker asset cache and ignores invalid responses',async()=>{
  let checked='';
  const version=await fetchPublishedMonitorBuild(async(url,options)=>{
    checked=url;
    assert.equal(options.cache,'no-store');
    assert.equal(options.credentials,'same-origin');
    return {ok:true,headers:new Map([['content-type','application/json']]),json:async()=>({id:'abcdef123456-xyz'})};
  });
  assert.equal(version,'abcdef123456-xyz');
  assert.match(checked,/^\/monitor-build\.json\?check=\d+$/);
  assert.equal(await fetchPublishedMonitorBuild(async()=>{throw Error('offline')}),null);
  assert.equal(await fetchPublishedMonitorBuild(async()=>({
    ok:true,headers:new Map([['content-type','text/html']]),json:async()=>({})
  })),null);
  assert.equal(MONITOR_BUILD_CHECK_INTERVAL_MS,60_000);
});

test('automatic reload never interrupts live or queued alerts',()=>{
  const base={updateReady:true,online:true,paired:true,activeCall:null,pending:0,idleMs:15_000};
  assert.equal(shouldReloadMonitor(base),true);
  for(const change of [
    {updateReady:false},{online:false},{paired:false},{activeCall:{id:'live'}},
    {pending:1},{idleMs:14_999}
  ])assert.equal(shouldReloadMonitor({...base,...change}),false,JSON.stringify(change));
});

test('Vite creates matching version in bundle and online monitor-build.json',()=>{
  const vite=fs.readFileSync(new URL('../vite.config.js',import.meta.url),'utf8');
  const monitor=fs.readFileSync(new URL('../src/notification-monitor.jsx',import.meta.url),'utf8');
  const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
  assert.match(vite,/__NISTI_MONITOR_BUILD_ID__/);
  assert.match(vite,/monitor-build\.json/);
  assert.match(vite,/generateBundle\(\)/);
  assert.match(monitor,/published!==__NISTI_MONITOR_BUILD_ID__/);
  assert.match(monitor,/shouldReloadMonitor/);
  assert.match(monitor,/window\.location\.reload\(\)/);
  assert.match(sw,/url\.pathname\.startsWith\('\/assets\/'\)/);
  assert.doesNotMatch(sw,/monitor-build\.json/);
});


test('monitor feed tolerates incomplete calls without rendering React objects or invalid dates',async()=>{
  const {normalizeMonitorCall,normalizeMonitorFeed}=await import('../src/notification-monitor-data.js');
  const feed=normalizeMonitorFeed({call:{id:53,platform:'SHOPEE',message:'RETIRAR CAPA',expires_at:'2026-10-20T21:00:00Z'},pending:2,duration_seconds:15,server_time:'2026-10-20T20:59:45Z'});
  assert.equal(feed.call.platform,'SHOPEE');
  assert.equal(feed.invalidCall,false);
  for(const bad of [undefined,null,[],{}, {id:1,platform:undefined,expires_at:'2026-10-20T21:00:00Z'},
    {id:1,platform:{name:'SHOPEE'},expires_at:'2026-10-20T21:00:00Z'},
    {id:1,platform:'SHOPEE',expires_at:'not-date'}])assert.equal(normalizeMonitorCall(bad),null);
  const bad=normalizeMonitorFeed({call:{id:1,platform:undefined},duration_seconds:'invalid',server_time:'wrong'});
  assert.equal(bad.invalidCall,true);
  assert.equal(bad.call,null);
  assert.equal(bad.duration,15);
  assert.equal(bad.offset,0);
  assert.deepEqual(normalizeMonitorFeed({call:null,pending:0}).call,null);
  assert.throws(()=>normalizeMonitorFeed(null),/Resposta inválida/);
});

test('kiosk screen reloads automatically after render failures with bounded retry delay',()=>{
  const entry=fs.readFileSync(new URL('../src/entry.jsx',import.meta.url),'utf8');
  assert.match(entry,/monitorRecoveryDelay/);
  assert.match(entry,/this\.retryTimer=window\.setTimeout\(\(\)=>window\.location\.reload\(\),delay\)/);
  assert.match(entry,/componentWillUnmount/);
  assert.match(entry,/Math\.min\(5000\*\(2\*\*\(count-1\)\),60000\)/);
  const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
  assert.match(sw,/nisti-id-v41/);
  const monitor=fs.readFileSync(new URL('../src/notification-monitor.jsx',import.meta.url),'utf8');
  assert.match(monitor,/normalizeMonitorFeed\(result\)/);
});


test('a rendering error in one active notification cannot take down the entire expedition monitor',()=>{
  const monitor=fs.readFileSync(new URL('../src/notification-monitor.jsx',import.meta.url),'utf8');
  const boundary=fs.readFileSync(new URL('../src/notification-monitor-call-boundary.jsx',import.meta.url),'utf8');
  assert.match(monitor,/<MonitorCallBoundary key=\{current\.id\} platform=\{current\.platform\} message=\{current\.message\}>/);
  assert.match(monitor,/try\{return playNotificationSound\(audioRef\.current,platform,/);
  assert.match(monitor,/catch\(error\)/);
  assert.doesNotMatch(monitor,/GradientText/);
  assert.match(boundary,/getDerivedStateFromError/);
  assert.match(boundary,/nid-live-fallback/);
  assert.match(boundary,/this\.props\.children/);
});


test('reconnect marker instructs open monitor to reload without asking ADM permission',()=>{
  const ui=fs.readFileSync(new URL('../src/notification-monitor.jsx',import.meta.url),'utf8');
  const api=fs.readFileSync(new URL('../src/notification-dispatch-router.js',import.meta.url),'utf8');
  const sql=fs.readFileSync(new URL('../supabase/migrations/20261021234000_nisti_dispatch_sender_reconnect_v7.sql',import.meta.url),'utf8');
  assert.match(ui,/reconnectMarkerRef/);
  assert.match(ui,/marker!==reconnectMarkerRef\.current/);
  assert.match(ui,/window\.location\.reload\(\)/);
  assert.match(api,/nisti_dispatch_public_next_v7/);
  assert.match(api,/nisti_dispatch_request_reconnect_v7/);
  assert.match(sql,/reconnect_requested_at/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.nisti_dispatch_request_reconnect_v7\(\) FROM PUBLIC,anon,authenticated/);
});

test('monitor feed history is bounded, validated, and never shows queued items',async()=>{
  const {normalizeMonitorHistory,normalizeMonitorFeed}=await import('../src/notification-monitor-data.js');
  const items=Array.from({length:13},(_,i)=>({
    id:13-i,platform:'SHOPEE',message:'RETIRAR CAPA FULL',
    started_at:'2026-10-21T12:00:00Z',status:i===3?'PENDING':i===0?'SHOWING':'EXPIRED'
  }));
  const history=normalizeMonitorHistory(items);
  assert.equal(history.length,8);
  assert.equal(history[0].id,'13');
  assert.equal(history[0].status,'SHOWING');
  assert.ok(history.every(x=>x.status!=='PENDING'));
  assert.equal(normalizeMonitorHistory(null).length,0);
  assert.equal(normalizeMonitorHistory([{id:1,platform:{evil:1},started_at:'2026-10-21T12:00:00Z',status:'EXPIRED'}]).length,0);
  const feed=normalizeMonitorFeed({call:null,server_time:'2026-10-21T12:00:00Z',recent:items});
  assert.equal(feed.recent.length,8);
  const invalid=normalizeMonitorFeed({call:null,recent:[{},null,{id:9,platform:'SHOPEE',status:'PENDING',started_at:'2026-10-21T12:00:00Z'}]});
  assert.deepEqual(invalid.recent,[]);
});
test('monitor receives recent completed notifications without leaking pending queue details',()=>{
  const api=fs.readFileSync(new URL('../src/notification-dispatch-router.js',import.meta.url),'utf8');
  const migration=fs.readFileSync(new URL('../supabase/migrations/20261021235000_nisti_dispatch_monitor_recent_v8.sql',import.meta.url),'utf8');
  assert.match(api,/nisti_dispatch_public_next_v8/);
  assert.match(migration,/nisti_dispatch_public_next_v7/);
  assert.match(migration,/started_at IS NOT NULL AND status IN \('SHOWING','EXPIRED'\)/);
  assert.match(migration,/LIMIT 8/);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.nisti_dispatch_public_next_v8\(\) TO service_role/);
  assert.doesNotMatch(migration,/to_jsonb\(v_call\)/);
});
