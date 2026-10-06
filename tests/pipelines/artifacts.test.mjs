import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {artifactHashes,verifyArtifact} from '../../scripts/ci/artifact-integrity.mjs';
import {assertPlanVariables} from '../../scripts/ci/assert-plan.mjs';
test('artifact verification rejects modified, extra or linked files',()=>{
 const root=mkdtempSync(join(tmpdir(),'scribe-artifact-'));
 try {
  mkdirSync(root+'/web');writeFileSync(root+'/api.zip','api');writeFileSync(root+'/web/index.html','web');
  const p={hashes:artifactHashes(root)};verifyArtifact(root,p);
  writeFileSync(root+'/web/index.html','changed');assert.throws(()=>verifyArtifact(root,p));
  writeFileSync(root+'/web/index.html','web');writeFileSync(root+'/web/unexpected.js','extra');assert.throws(()=>verifyArtifact(root,p));
  rmSync(root+'/web/unexpected.js');symlinkSync(root+'/api.zip',root+'/web/link');assert.throws(()=>verifyArtifact(root,p),/symlink/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('saved infrastructure plan must match current environment and policy',()=>{
 const plan={variables:{tenant_id:{value:'work'},allow_raw_browser:{value:false},user_ids:{value:['a','b']}}};
 assertPlanVariables(plan,{tenant_id:'work',allow_raw_browser:false,user_ids:['b','a']});
 assert.throws(()=>assertPlanVariables(plan,{tenant_id:'personal'}));
 assert.throws(()=>assertPlanVariables(plan,{allow_raw_browser:true}));
});
