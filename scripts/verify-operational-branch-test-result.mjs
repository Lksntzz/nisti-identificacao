import fs from 'node:fs';

const logPath = process.argv[2];
const exitCode = Number(process.argv[3]);
if (!logPath || !Number.isInteger(exitCode)) {
  console.error('Uso: node scripts/verify-operational-branch-test-result.mjs <log> <exitCode>');
  process.exit(2);
}

const source = fs.readFileSync(logPath, 'utf8');
const expected = new Set([
  'Phase 6C does not enable production cutover switches',
  'production write and read cutover switches remain off by default',
  'Phase 6D still does not enable production cutover',
  'Phase 6E remains completely inactive by default'
]);

const failures = [...source.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1].trim());
const unexpected = failures.filter(name => !expected.has(name));
const missing = [...expected].filter(name => !failures.includes(name));

if (exitCode === 0 && failures.length === 0) {
  console.log(JSON.stringify({
    ok: true,
    classification: 'full-regression-green',
    exit_code: exitCode,
    failure_count: 0,
    failures: []
  }, null, 2));
  process.exit(0);
}

if (unexpected.length || missing.length || failures.length !== expected.size) {
  console.error(JSON.stringify({
    ok: false,
    exit_code: exitCode,
    failures,
    unexpected,
    missing
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  classification: 'operational-branch-known-default-off-assertions-only',
  exit_code: exitCode,
  failure_count: failures.length,
  failures
}, null, 2));
