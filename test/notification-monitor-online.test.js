import test from 'node:test';
import assert from 'node:assert/strict';
import { DISPATCH_PLATFORMS } from '../src/notification-dispatch-options.js';
import { DISPATCH_SOUND_PATTERNS,playNotificationSound,missingSoundPlatforms } from '../src/notification-platform-sounds.js';
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
  assert.equal(starts,DISPATCH_SOUND_PATTERNS.SHOPEE.notes.length);
  assert.equal(stops,starts);
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
