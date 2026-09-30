import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const publicMain=fs.readFileSync(new URL('../src/public-main.jsx',import.meta.url),'utf8');
const scanner=fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx',import.meta.url),'utf8');
const mural=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');

test('scanner and Mural are mutually exclusive in the public shell',()=>{
  assert.match(publicMain,/publicView === 'scanner' \? \(/);
  assert.match(publicMain,/<GtinScannerOverlay embedded \/>/);
  assert.match(publicMain,/\) : muralAccess \? \(/);
  assert.match(publicMain,/<MuralNisti onUnreadChange=\{setMuralUnread\} \/>/);
});

test('leaving Scanner stops camera tracks and animation loop on unmount',()=>{
  assert.match(scanner,/const stopCamera = useCallback\(\(\) => \{/);
  assert.match(scanner,/cancelAnimationFrame\(animationRef\.current\)/);
  assert.match(scanner,/for \(const track of stream\.getTracks\(\)\) track\.stop\(\)/);
  assert.match(scanner,/videoRef\.current\.srcObject = null/);
  assert.match(scanner,/useEffect\(\(\) => \(\) => stopCamera\(\), \[stopCamera\]\)/);
});

test('returning to embedded Scanner attempts to start camera again after remount',()=>{
  assert.match(scanner,/if \(!embedded \|\| autoStartAttemptedRef\.current\) return/);
  assert.match(scanner,/autoStartAttemptedRef\.current = true/);
  assert.match(scanner,/startCamera\(\)/);
});

test('Mural has a direct path back to Scanner and QA access stays server-gated',()=>{
  assert.match(publicMain,/onOpenScanner=\{\(\) => setPublicView\('scanner'\)\}/);
  assert.match(publicMain,/onOpenMural=\{\(\) => setPublicView\('mural'\)\}/);
  assert.match(router,/const MURAL_PUBLIC_RELEASED = false/);
  assert.match(router,/!MURAL_PUBLIC_RELEASED && !qaAuthorized/);
});

test('Mural smoke content supports reading product collection and notice details',()=>{
  assert.match(mural,/\/api\/mural\/\$\{item\.id\}\/read/);
  assert.match(mural,/\/api\/mural\/collections\/\$\{encodeURIComponent\(slug\)\}/);
  assert.match(mural,/NoticeLabel/);
  assert.match(mural,/ProductMeta/);
});
