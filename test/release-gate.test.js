import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {approvedReleasePull,passedProductionGate,passedProductionGateWorkflowRuns,verifyRelease} from '../scripts/verify-reviewed-release.mjs';

const HEAD='a'.repeat(40),MERGED='b'.repeat(40);
const validPr={
  number:594,state:'closed',merged_at:'2026-10-21T13:17:10Z',
  base:{ref:'main'},head:{sha:HEAD},merge_commit_sha:MERGED
};
const validCheck={head_sha:HEAD,name:'build',app:{slug:'github-actions'},status:'completed',conclusion:'success'};

test('release requires PR merged into main at the exact commit',()=>{
  assert.equal(approvedReleasePull([validPr],MERGED)?.number,594);
  for(const wrong of [
    {...validPr,merged_at:null},
    {...validPr,base:{ref:'develop'}},
    {...validPr,state:'open'},
    {...validPr,merge_commit_sha:HEAD}
  ])assert.equal(approvedReleasePull([wrong],MERGED),null);
  assert.equal(approvedReleasePull([],MERGED),null);
});

test('premerge Production Gate must pass on the exact PR source SHA',()=>{
  assert.equal(passedProductionGate([validCheck],HEAD),true);
  for(const wrong of [
    {...validCheck,head_sha:MERGED},
    {...validCheck,conclusion:'failure'},
    {...validCheck,conclusion:'skipped'},
    {...validCheck,status:'in_progress'},
    {...validCheck,name:'not-a-gate'},
    {...validCheck,app:{slug:'third-party'}}
  ])assert.equal(passedProductionGate([wrong],HEAD),false);
});

test('successful Production Gate workflow validates even if GitHub check-runs lag',()=>{
  const verifiedRun={name:'Production Gate',path:'.github/workflows/production-gate.yml',
    event:'pull_request',head_sha:HEAD,status:'completed',conclusion:'success'};
  assert.equal(passedProductionGateWorkflowRuns([verifiedRun],HEAD),true);
  for(const wrong of [
    {...verifiedRun,name:'Fake Gate'},
    {...verifiedRun,path:'.github/workflows/fake.yml'},
    {...verifiedRun,event:'push'},
    {...verifiedRun,head_sha:MERGED},
    {...verifiedRun,status:'in_progress'},
    {...verifiedRun,conclusion:'failure'}
  ])assert.equal(passedProductionGateWorkflowRuns([wrong],HEAD),false);
});

test('workflow success overrides stale check-run but never an unapproved workflow',async()=>{
  const goodRun={name:'Production Gate',path:'.github/workflows/production-gate.yml',
    event:'pull_request',head_sha:HEAD,status:'completed',conclusion:'success'};
  const queried=[];
  const verified=await verifyRelease({
    repository:'Lksntzz/nisti-identificacao',sha:MERGED,token:'stub',
    request:async path=>{
      queried.push(path);
      if(path.endsWith('/pulls'))return [validPr];
      if(path.includes('/check-runs'))return {check_runs:[{...validCheck,status:'in_progress',conclusion:null}]};
      return {workflow_runs:[goodRun]};
    }
  });
  assert.equal(verified.number,594);
  assert.ok(queried.some(p=>p.includes('/actions/workflows/production-gate.yml/runs?head_sha=')));
  await assert.rejects(verifyRelease({
    repository:'Lksntzz/nisti-identificacao',sha:MERGED,token:'stub',
    request:async path=>path.endsWith('/pulls')?[validPr]:
      path.includes('/check-runs')?{check_runs:[]}:{workflow_runs:[{...goodRun,head_sha:MERGED}]}
  }),/não aprovados/);
});

test('deployment gate checks association and premerge test result and fails closed',async()=>{
  const paths=[];
  const goodRequest=async(path)=>{
    paths.push(path);
    if(path.endsWith('/pulls'))return [validPr];
    return {check_runs:[validCheck]};
  };
  const result=await verifyRelease({repository:'Lksntzz/nisti-identificacao',sha:MERGED,token:'stub',request:goodRequest});
  assert.equal(result.number,594);
  assert.equal(paths.length,2);
  await assert.rejects(verifyRelease({repository:'Lksntzz/nisti-identificacao',sha:MERGED,token:'stub',
    request:async()=>[]}),/sem PR integrado/);
  await assert.rejects(verifyRelease({repository:'Lksntzz/nisti-identificacao',sha:MERGED,token:'stub',
    request:async path=>path.endsWith('/pulls')?[validPr]:{check_runs:[]}}),/não aprovados/);
  await assert.rejects(verifyRelease({repository:'Lksntzz/nisti-identificacao',sha:'123',token:'stub',
    request:goodRequest}),/Identificação/);
});

test('production workflow enforces the gate before deploy and never logs the token',()=>{
  const workflow=fs.readFileSync('.github/workflows/deploy-production.yml','utf8');
  assert.match(workflow,/pull-requests: read/);
  assert.match(workflow,/checks: read/);
  assert.match(workflow,/actions: read/);
  const gate=workflow.indexOf('node scripts/verify-reviewed-release.mjs');
  const deploy=workflow.indexOf('npx wrangler deploy');
  assert.ok(gate>0&&deploy>gate);
  assert.match(workflow,/GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  const script=fs.readFileSync('scripts/verify-reviewed-release.mjs','utf8');
  assert.doesNotMatch(script,/console\.log\([^\n]*token/);
});
