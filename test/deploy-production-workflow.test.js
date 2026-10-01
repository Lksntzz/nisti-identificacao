import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/deploy-production.yml', 'utf8');

test('production deploy skips remote D1 migration checks when no D1 migration changed', () => {
  assert.match(workflow, /fetch-depth:\s*2/);
  assert.match(workflow, /name: Detect D1 migration changes/);
  assert.match(workflow, /git diff --name-only HEAD\^ HEAD -- 'migrations\/\*\.sql'/);
  assert.match(workflow, /id: d1_changes/);
  assert.match(workflow, /if: steps\.d1_changes\.outputs\.changed == 'true'[\s\S]*wrangler d1 migrations apply nisti-identificacao --remote/);
  assert.match(workflow, /name: Deploy nisti-identificacao[\s\S]*npx wrangler deploy/);
});

test('production deploy fails safe when the previous commit cannot be inspected', () => {
  assert.match(workflow, /Previous commit unavailable; fail safe by requiring D1 migration check/);
  assert.match(workflow, /echo "changed=true" >> "\$GITHUB_OUTPUT"/);
});
