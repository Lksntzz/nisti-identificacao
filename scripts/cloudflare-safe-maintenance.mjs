import { execFileSync } from 'node:child_process';

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const worker = process.env.WORKER_NAME;
const token = process.env.CLOUDFLARE_API_TOKEN;

if (!accountId || !worker || !token) {
  throw new Error('Cloudflare credentials are not configured.');
}

const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json'
};

async function cf(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const raw = await response.text();
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  if (!response.ok || data.success === false) {
    const detail = JSON.stringify(data.errors || data.messages || data.raw || data);
    throw new Error(`${options.method || 'GET'} ${path} failed (${response.status}): ${detail}`);
  }
  return data;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.deployments)) return value.deployments;
  if (Array.isArray(value?.versions)) return value.versions;
  return [];
}

function dateOf(item) {
  return new Date(
    item?.created_on ||
    item?.created_at ||
    item?.metadata?.created_on ||
    item?.metadata?.created_at ||
    0
  ).getTime() || 0;
}

const keepDeploymentCount = 10;
const keepVersionCount = 20;

const depResponse = await cf(`/workers/scripts/${encodeURIComponent(worker)}/deployments`);
let deployments = asArray(depResponse.result).sort((a, b) => dateOf(b) - dateOf(a));

console.log(`Deployments encontrados: ${deployments.length}`);
deployments.forEach((d, i) => {
  const created = dateOf(d) ? new Date(dateOf(d)).toISOString() : 'unknown';
  console.log(`  #${i + 1} id=${d.id || '?'} created=${created}`);
});

const deploymentDeleteCandidates = deployments
  .slice(keepDeploymentCount)
  .filter(d => d.id);

let deletedDeployments = 0;
for (const deployment of deploymentDeleteCandidates) {
  try {
    await cf(
      `/workers/scripts/${encodeURIComponent(worker)}/deployments/${encodeURIComponent(deployment.id)}`,
      { method: 'DELETE' }
    );
    deletedDeployments += 1;
    console.log(`Deployment antigo removido: ${deployment.id}`);
  } catch (error) {
    console.warn(`Deployment ${deployment.id} preservado: ${error.message}`);
  }
}

const depAfter = await cf(`/workers/scripts/${encodeURIComponent(worker)}/deployments`);
deployments = asArray(depAfter.result).sort((a, b) => dateOf(b) - dateOf(a));

const referencedVersions = new Set();
for (const deployment of deployments) {
  for (const version of deployment.versions || []) {
    const id = version?.version_id || version?.id;
    if (id) referencedVersions.add(String(id));
  }
}

const versionsRaw = execFileSync(
  'npx',
  ['wrangler', 'versions', 'list', '--name', worker, '--json'],
  { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
);
const versions = JSON.parse(versionsRaw).sort((a, b) => dateOf(b) - dateOf(a));

console.log(`Versions encontradas: ${versions.length}`);
console.log(`Versions referenciadas por deployments: ${referencedVersions.size}`);

const versionDeleteCandidates = versions
  .slice(keepVersionCount)
  .filter(v => {
    const id = String(v.id || '');
    return id && !referencedVersions.has(id);
  });

console.log(`Versions candidatas à remoção: ${versionDeleteCandidates.length}`);

let deletedVersions = 0;
for (const version of versionDeleteCandidates) {
  const id = String(version.id);
  try {
    await cf(
      `/workers/workers/${encodeURIComponent(worker)}/versions/${encodeURIComponent(id)}`,
      { method: 'DELETE', body: '{}' }
    );
    deletedVersions += 1;
    console.log(`Version antiga não referenciada removida: ${id}`);
  } catch (error) {
    console.warn(`Version ${id} preservada: ${error.message}`);
  }
}

console.log('');
console.log('=== RESULTADO DA LIMPEZA SEGURA ===');
console.log(`Deployments removidos: ${deletedDeployments}`);
console.log(`Versions não referenciadas removidas: ${deletedVersions}`);
console.log(`Deployments preservados: ${deployments.length}`);
console.log('D1: não alterado');
console.log('R2: não alterado');
console.log('Vectorize: não alterado');
console.log('Produção atual: preservada');
