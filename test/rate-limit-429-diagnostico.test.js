import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(p, 'utf8');

test('429 do limitador geral e registrado sem IP', () => {
  const src = read('src/edge-router.js');
  const i = src.indexOf("console.warn('[Rate limit] 429'");
  assert.ok(i > 0);
  const line = src.slice(i, src.indexOf('\n', i));
  assert.match(line, /limiter: bindingName/);
  assert.doesNotMatch(line, /CF-Connecting-IP|clientIp|rateLimitKey/);
});

test('wrangler liga logs sem gastar cota com cada pedido e limite geral e 1200', () => {
  const toml = read('wrangler.toml');
  assert.match(toml, /\[observability\]\s*\nenabled = true/);
  assert.match(toml, /\[observability\.logs\]\s*\ninvocation_logs = false/);
  assert.match(toml, /name = "GLOBAL_RATE_LIMITER"\s*\nnamespace_id = "\d+"\s*\nsimple\.limit = 1200/);
  assert.match(toml, /name = "LOGIN_RATE_LIMITER"\s*\nnamespace_id = "\d+"\s*\nsimple\.limit = 10\b/);
});

test('Publicar do Mural nao duplica o post quando o envio e cortado no meio', () => {
  const src = read('src/mural/MuralPublishWorkspace.jsx');
  assert.match(src, /createdPostIdRef = useRef\(null\)/);
  assert.match(src, /: createdPostIdRef\.current;/);
  assert.match(src, /createdPostIdRef\.current = id;/);
  assert.match(src, /err\?\.status === 429/);
});
