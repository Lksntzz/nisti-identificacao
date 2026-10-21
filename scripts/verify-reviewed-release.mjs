import { pathToFileURL } from 'node:url';

// This guards *deployment* only. GitHub branch protection must still be
// configured by a repository administrator in Settings -> Rules -> Rulesets.
export function approvedReleasePull(pulls, commitSha, base='main') {
  return (Array.isArray(pulls) ? pulls : []).find(pr =>
    pr?.state === 'closed' &&
    Boolean(pr?.merged_at) &&
    pr?.base?.ref === base &&
    pr?.merge_commit_sha === commitSha
  ) || null;
}

export function passedProductionGate(checkRuns, headSha) {
  return (Array.isArray(checkRuns) ? checkRuns : []).some(run =>
    run?.head_sha === headSha &&
    run?.name === 'build' &&
    run?.app?.slug === 'github-actions' &&
    run?.status === 'completed' &&
    run?.conclusion === 'success'
  );
}

async function githubJson(path, token, attemptLimit=5) {
  for (let attempt=1;attempt<=attemptLimit;attempt++) {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),12000);
    try {
      const response=await fetch('https://api.github.com'+path,{
        signal:controller.signal,
        headers:{
          authorization:'Bearer '+token,
          accept:'application/vnd.github+json',
          'x-github-api-version':'2022-11-28',
          'user-agent':'nisti-deploy-pr-gate'
        }
      });
      if (!response.ok) throw new Error('GitHub release verification HTTP '+response.status);
      return await response.json();
    }catch(error){
      if (attempt===attemptLimit) throw error;
      // Merged PR metadata can briefly lag behind a new main push.
      await new Promise(resolve=>setTimeout(resolve,attempt*1200));
    }finally{clearTimeout(timeout)}
  }
}

export async function verifyRelease({repository,sha,token,request=githubJson}){
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository||'') ||
      !/^[0-9a-f]{40}$/.test(sha||'') || !token)
    throw new Error('Identificação do commit ou credencial GitHub ausente.');

  const prs=await request('/repos/'+repository+'/commits/'+sha+'/pulls',token);
  const approved=approvedReleasePull(prs,sha);
  if(!approved)throw new Error('Deploy negado: a main foi alterada sem PR integrado.');

  const headSha=approved.head?.sha;
  if(!/^[0-9a-f]{40}$/.test(headSha||''))throw new Error('PR sem SHA de origem verificável.');

  const checkResults=await request('/repos/'+repository+'/commits/'+headSha+'/check-runs?per_page=100',token);
  if(!passedProductionGate(checkResults?.check_runs,headSha))
    throw new Error('Deploy negado: testes de Production Gate não aprovados no PR.');

  return {number:approved.number,sha,headSha};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const result=await verifyRelease({
      repository:process.env.GITHUB_REPOSITORY,
      sha:process.env.GITHUB_SHA,
      token:process.env.GITHUB_TOKEN
    });
    console.log('Publicação autorizada: PR #'+result.number+' com testes aprovados.');
  }catch(error){
    console.error('::error::'+String(error?.message||error));
    process.exitCode=1;
  }
}
