import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('NISTI admin keeps business actions and server-derived KPI values',()=>{
 const src=read('src/admin/NotificationDispatchView.jsx');
 assert.match(src,/api\/admin\/dispatch\/batch/);
 assert.match(src,/api\/admin\/dispatch\/options/);
 assert.match(src,/state\?\.pending/);
 assert.match(src,/state\?\.showing/);
 assert.match(src,/state\?\.today/);
 assert.match(src,/nid-admin-v5/);
 assert.match(src,/nid-preview-queue/);
 assert.match(src,/dispatchOptionValid/);
 assert.match(src,/onClick=\{saveOptions\}/);
 assert.match(src,/Acesso direto ao monitor/);
 assert.doesNotMatch(src,/approvePair|Gerar link privado permanente/);
});
test('expedition stage isolates active calls and uses safe text emphasis',()=>{
 const monitor=read('src/notification-monitor.jsx');
 const css=read('src/notification-dispatch.css');
 assert.match(monitor,/MonitorCallBoundary/);
 assert.match(monitor,/nid-monitor-mode-safe/);
 assert.doesNotMatch(monitor,/GradientText/);
 assert.match(css,/nid-monitor-mode-safe/);
 assert.match(monitor,/key=\{current\.id\}/);
 assert.match(monitor,/remainingSeconds/);
 assert.match(monitor,/seconds\/duration\*100/);
 assert.match(monitor,/play\(call\.platform\)/);
 assert.match(monitor,/lastBeepId/);
 assert.match(monitor,/!audioOn&&<button/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 const boundary=read('src/notification-monitor-call-boundary.jsx');
 assert.match(boundary,/componentDidCatch/);
 assert.match(boundary,/nid-live-fallback-message/);
});
test('Lucide icon registry is static and not loaded from CDN',()=>{
 const icon=read('src/notification-ui/DispatchIcon.jsx');
 assert.match(icon,/Lucide icon SVGs/);
 assert.match(icon,/strokeLinecap="round"/);
 assert.match(icon,/React\.createElement/);
 assert.doesNotMatch(icon,/fetch\(|dangerouslySetInnerHTML|script/);
});
test('visual style respects reduced motion and multiple screen sizes',()=>{
 const css=read('src/notification-dispatch.css');
 assert.match(css,/nid-monitor-v5/);
 assert.match(css,/nid-admin-v5/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/max-width:760px/);
 assert.match(css,/nid-notification-in/);
});
