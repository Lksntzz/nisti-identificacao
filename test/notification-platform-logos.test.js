import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DISPATCH_PLATFORMS} from '../src/notification-dispatch-options.js';
import {dispatchPlatformLogoUrl,PLATFORM_LOGO_FILES} from '../src/notification-platform-logos.js';

const projectDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('all ten dispatch channels map to local logo assets',()=>{
  assert.equal(DISPATCH_PLATFORMS.length,10);
  assert.equal(Object.keys(PLATFORM_LOGO_FILES).length,10);
  const seen=new Set();
  for(const platform of DISPATCH_PLATFORMS){
    const url=dispatchPlatformLogoUrl(platform);
    assert.match(url,/^\/platform-logos\/[a-z-]+\.svg$/);
    const asset=path.join(projectDir,'public',url.slice(1));
    assert.ok(existsSync(asset),'Missing: '+asset);
    const content=readFileSync(asset,'utf8');
    assert.match(content,/<svg\b/);
    assert.match(content,/<\/svg>/);
    assert.doesNotMatch(content,/<script\b|<foreignObject\b|onload\s*=|javascript:/i);
    seen.add(url);
  }
  assert.equal(seen.size,8);
});
test('all Mercado Livre variants use identical brand artwork with distinct labels',()=>{
  const variants=['MERCADO LIVRE ANTIGO','MERCADO LIVRE NOVO','MERCADO LIVRE'];
  for(const p of variants)assert.equal(dispatchPlatformLogoUrl(p),'/platform-logos/mercado-livre.svg');
});
test('logo handling is resilient to missing or unknown platform',()=>{
  assert.equal(dispatchPlatformLogoUrl('OTHER'),null);
  assert.equal(dispatchPlatformLogoUrl(undefined),null);
  assert.equal(dispatchPlatformLogoUrl(null),null);
  const component=readFileSync(path.join(projectDir,'src/notification-ui/PlatformLogo.jsx'),'utf8');
  assert.match(component,/onError=\{\(\)=>setFailed\(true\)\}/);
  assert.match(component,/nid-platform-logo-fallback/);
  assert.doesNotMatch(component,/dangerouslySetInnerHTML|fetch\(/);
});
test('large logo shown in expedition stage; small logos throughout admin',()=>{
  const monitor=readFileSync(path.join(projectDir,'src/notification-monitor.jsx'),'utf8');
  const admin=readFileSync(path.join(projectDir,'src/admin/NotificationDispatchView.jsx'),'utf8');
  assert.match(monitor,/<PlatformLogo platform=\{current\.platform\} size="large"\/>/);
  assert.match(admin,/function ChannelMark\(\{platform\}\)\{return <PlatformLogo platform=\{platform\}/);
  assert.match(monitor,/remainingSeconds/);
  assert.match(monitor,/play\(call\.platform\)/);
  assert.match(admin,/dispatchOptionValid/);
});
