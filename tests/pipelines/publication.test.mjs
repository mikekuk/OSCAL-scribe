import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {parseDocument} from 'yaml';
import {publisherEndpoint} from '../../scripts/ci/publisher-target.mjs';

const endpoint='https://scribe-example.documents.azure.com:443/';
test('publication requires one unambiguous Cosmos account and a valid HTTPS endpoint',()=>{
  assert.equal(publisherEndpoint([{documentEndpoint:endpoint}],'rg-test'),endpoint);
  assert.throws(()=>publisherEndpoint([],'rg-test'),/No Cosmos account.*rg-test.*deploy=true/);
  assert.throws(()=>publisherEndpoint([{},{}],'rg-test'),/Found 2 Cosmos accounts.*Refusing to choose/);
  assert.throws(()=>publisherEndpoint([{}],'rg-test'),/no valid document endpoint/);
  assert.throws(()=>publisherEndpoint([{documentEndpoint:'http://example.com'}],'rg-test'),/HTTPS/);
});

for(const file of ['pipelines/demo.yml','pipelines/content.yml']) {
  const pipeline=parseDocument(readFileSync(file,'utf8')).toJS();
  const script=pipeline.steps.find(s=>s.template?.endsWith('azure-step.yml')).parameters.script;
  // Execute the actual YAML shell fragment with local stand-ins: never call Azure or npm.
  // This specifically catches export masking a failing command substitution under set -e.
  const shell=`set -euo pipefail
node() {
  if [ "$1" = scripts/ci/publisher-target.mjs ]; then
    if [ "$DISCOVERY_RESULT" = fail ]; then echo 'Discovery failed' >&2; return 23; fi
    echo '${endpoint}'
  fi
}
npm() { bash -c 'echo "PUBLISHED:$COSMOS_ENDPOINT"'; }
${script}`;
  test(`${file} stops before publication when discovery fails`,()=>{
    const result=spawnSync('bash',['-c',shell],{encoding:'utf8',env:{...process.env,DISCOVERY_RESULT:'fail'}});
    assert.equal(result.status,23,result.stderr);
    assert.equal(result.stdout,'');assert.match(result.stderr,/Discovery failed/);
  });
  test(`${file} exports the successfully discovered endpoint to publication`,()=>{
    const result=spawnSync('bash',['-c',shell],{encoding:'utf8',env:{...process.env,DISCOVERY_RESULT:'success'}});
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout.trim(),'PUBLISHED:'+endpoint);
  });
}

test('standalone publisher rejects an empty endpoint before trying to load a release',()=>{
  const result=spawnSync(process.execPath,['--import','tsx','scripts/publish-content.ts','work/nonexistent-publication-fixture.json'],{encoding:'utf8',env:{...process.env,COSMOS_ENDPOINT:''}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/COSMOS_ENDPOINT is missing/);
  assert.doesNotMatch(result.stderr,/ERR_INVALID_URL|ENOENT/);
});
