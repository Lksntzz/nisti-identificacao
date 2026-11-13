import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCommercialManager } from '../src/ga/commerce-manager-fetch.js';

test('no máximo 3 consultas simultâneas e as demais esperam na fila', async () => {
  let active = 0, peak = 0;
  const releases = [];
  const fetchImpl = () => new Promise(res => {
    active++; peak = Math.max(peak, active);
    releases.push(() => { active--; res({ ok: true, json: async () => ({}) }); });
  });
  const all = Array.from({ length: 8 }, (_, i) => fetchCommercialManager('/x' + i, { fetchImpl }));
  await new Promise(r => setTimeout(r, 10));
  assert.equal(active, 3);
  while (releases.length) { releases.shift()(); await new Promise(r => setTimeout(r, 5)); }
  await Promise.all(all);
  assert.equal(peak, 3);
});

test('consulta cancelada na fila é rejeitada e não trava as outras', async () => {
  const releases = [];
  const fetchImpl = () => new Promise(res => releases.push(() => res({ ok: true, json: async () => ({}) })));
  const first = [1, 2, 3].map(i => fetchCommercialManager('/a' + i, { fetchImpl }));
  const c = new AbortController();
  const queued = fetchCommercialManager('/q', { fetchImpl, signal: c.signal });
  const after = fetchCommercialManager('/z', { fetchImpl });
  c.abort();
  await assert.rejects(queued);
  while (releases.length) { releases.shift()(); await new Promise(r => setTimeout(r, 5)); }
  await Promise.all([...first, after]);
});
