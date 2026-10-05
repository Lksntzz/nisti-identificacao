import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const bridge=fs.readFileSync(new URL('../src/canva-bridge-entry.js',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../src/edge-router.js',import.meta.url),'utf8');

test('Canva status does not downgrade a stored session on auxiliary API failure',()=>{
  assert.ok(bridge.includes("RECOVERABLE_STATUS_REASONS"));
  assert.ok(bridge.includes("nisti_canva_connection_get_v1"));
  assert.ok(bridge.includes("connected:true"));
  assert.ok(bridge.includes("status_degraded:true"));
});

test('edge router uses resilient Canva bridge entrypoint',()=>{
  assert.ok(edge.includes("handleCanvaBridgeRequest"));
  assert.ok(edge.includes("./canva-bridge-entry.js"));
});
