const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const currentBranch = process.env.CLEANUP_BRANCH || '';
const prNumber = Number(process.env.PR_NUMBER || 0);

if (!repo || !token) throw new Error('GitHub context unavailable.');

const apiBase = 'https://api.github.com';
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json'
};

async function gh(path, options = {}) {
  const response = await fetch(apiBase + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) }
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed (${response.status}): ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function paginate(path) {
  const results = [];
  for (let page = 1; page <= 20; page++) {
    const separator = path.includes('?') ? '&' : '?';
    const batch = await gh(`${path}${separator}per_page=100&page=${page}`);
    if (!Array.isArray(batch)) break;
    results.push(...batch);
    if (batch.length < 100) break;
  }
  return results;
}

const protectedExact = new Set(['main', 'develop', 'production', 'prod']);
const protectedPrefixes = ['backup/', 'data/', 'release/', 'hotfix/'];

function isProtectedBranch(name) {
  return protectedExact.has(name) ||
    protectedPrefixes.some(prefix => name.startsWith(prefix)) ||
    name === currentBranch;
}

function branchRefPath(name) {
  return 'heads/' + name.split('/').map(encodeURIComponent).join('/');
}

console.log('=== AUDITORIA DE BRANCHES ===');
const [branches, openPrs, closedPrs] = await Promise.all([
  paginate(`/repos/${repo}/branches`),
  paginate(`/repos/${repo}/pulls?state=open`),
  paginate(`/repos/${repo}/pulls?state=closed`)
]);

const openHeads = new Set(openPrs.map(pr => pr.head?.ref).filter(Boolean));
const mergedHeads = new Set(closedPrs.filter(pr => pr.merged_at).map(pr => pr.head?.ref).filter(Boolean));

console.log(`Branches encontradas: ${branches.length}`);
console.log(`PRs abertos: ${openPrs.length}`);
console.log(`Branches com PR mergeado conhecido: ${mergedHeads.size}`);

const branchDeleteCandidates = branches
  .map(item => item.name)
  .filter(name =>
    mergedHeads.has(name) &&
    !openHeads.has(name) &&
    !isProtectedBranch(name)
  )
  .sort();

console.log(`Branches mergeadas candidatas à remoção: ${branchDeleteCandidates.length}`);

const deletedBranches = [];
const preservedBranches = [];

for (const name of branchDeleteCandidates) {
  try {
    await gh(`/repos/${repo}/git/refs/${branchRefPath(name)}`, { method: 'DELETE' });
    deletedBranches.push(name);
    console.log(`Branch removida: ${name}`);
  } catch (error) {
    preservedBranches.push({ name, reason: error.message });
    console.warn(`Branch preservada: ${name} — ${error.message}`);
  }
}

console.log('');
console.log('=== AUDITORIA DE ACTIONS CACHE ===');
const cachesResponse = await gh(`/repos/${repo}/actions/caches?per_page=100`);
const caches = Array.isArray(cachesResponse?.actions_caches) ? cachesResponse.actions_caches : [];
caches.sort((a, b) => new Date(b.last_accessed_at || b.created_at || 0) - new Date(a.last_accessed_at || a.created_at || 0));

const cacheCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
const cacheCandidates = caches
  .slice(5)
  .filter(cache => new Date(cache.last_accessed_at || cache.created_at || 0).getTime() < cacheCutoff);

let deletedCaches = 0;
for (const cache of cacheCandidates) {
  try {
    await gh(`/repos/${repo}/actions/caches/${cache.id}`, { method: 'DELETE' });
    deletedCaches += 1;
    console.log(`Cache removido: id=${cache.id} key=${cache.key}`);
  } catch (error) {
    console.warn(`Cache preservado: id=${cache.id} — ${error.message}`);
  }
}

console.log('');
console.log('=== AUDITORIA DE ACTIONS ARTIFACTS ===');
const artifactsResponse = await gh(`/repos/${repo}/actions/artifacts?per_page=100`);
const artifacts = Array.isArray(artifactsResponse?.artifacts) ? artifactsResponse.artifacts : [];
artifacts.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

const artifactCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
const artifactCandidates = artifacts
  .slice(10)
  .filter(artifact => artifact.expired || new Date(artifact.created_at || 0).getTime() < artifactCutoff);

let deletedArtifacts = 0;
for (const artifact of artifactCandidates) {
  try {
    await gh(`/repos/${repo}/actions/artifacts/${artifact.id}`, { method: 'DELETE' });
    deletedArtifacts += 1;
    console.log(`Artifact removido: id=${artifact.id} name=${artifact.name}`);
  } catch (error) {
    console.warn(`Artifact preservado: id=${artifact.id} — ${error.message}`);
  }
}

console.log('');
console.log('=== RESULTADO DA LIMPEZA GITHUB ===');
console.log(`Branches removidas: ${deletedBranches.length}`);
console.log(`Branches que falharam e foram preservadas: ${preservedBranches.length}`);
console.log(`Caches removidos: ${deletedCaches}`);
console.log(`Artifacts removidos: ${deletedArtifacts}`);
console.log('main: preservada');
console.log('develop: preservada');
console.log('backup/*: preservadas');
console.log('data/*: preservadas');
console.log('PRs abertos: preservados');

if (prNumber && currentBranch) {
  console.log('');
  console.log('=== LIMPEZA DO PR TEMPORÁRIO ===');
  try {
    await gh(`/repos/${repo}/pulls/${prNumber}`, {
      method: 'PATCH',
      body: JSON.stringify({ state: 'closed' })
    });
    console.log(`PR temporário #${prNumber} encerrado.`);
  } catch (error) {
    console.warn(`Não foi possível fechar o PR temporário: ${error.message}`);
  }

  try {
    await gh(`/repos/${repo}/git/refs/${branchRefPath(currentBranch)}`, { method: 'DELETE' });
    console.log(`Branch temporária removida: ${currentBranch}`);
  } catch (error) {
    console.warn(`Não foi possível remover a branch temporária: ${error.message}`);
  }
}
