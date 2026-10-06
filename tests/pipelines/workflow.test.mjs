import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {parseDocument} from 'yaml';
const files=['azure-pipelines.yml',...readdirSync('pipelines').filter(f=>f.endsWith('.yml')).map(f=>`pipelines/${f}`),...readdirSync('pipelines/templates').map(f=>`pipelines/templates/${f}`)];
function visit(v,f){
  if(!v || typeof v!=='object')return;
  if(v.template)assert.ok(existsSync(resolve(dirname(f),v.template)),`${f}: missing template ${v.template}`);
  if(v.task==='AzureCLI@2'){
    assert.equal(v.inputs.addSpnToEnvironment,true);
    assert.equal(v.env.SYSTEM_ACCESSTOKEN,'$(System.AccessToken)');
  }
  for(const x of Object.values(v))visit(x,f);
}
test('pipeline YAML parses and every referenced local template exists',()=>{
 for(const f of files){const d=parseDocument(readFileSync(f,'utf8'));assert.deepEqual(d.errors,[],f);visit(d.toJS(),f);}
});
test('main updates deploy, PRs are excluded, infrastructure approval and shared lock remain',()=>{
 const d=parseDocument(readFileSync('azure-pipelines.yml','utf8')).toJS();
 assert.deepEqual(d.trigger.branches.include,['main']);
 assert.equal(d.parameters.find(p=>p.name==='deploy').default,true);
 const stages=Object.values(d.stages[1])[0];
 assert.match(stages.find(s=>s.stage==='Plan').condition,/ne\(variables\['Build.Reason'\], 'PullRequest'\)/);
 assert.match(stages.find(s=>s.stage==='Review').condition,/hasChanges/);
 const deploy=stages.find(s=>s.stage==='Deploy');
 assert.equal(deploy.lockBehavior,'sequential');
 assert.equal(deploy.jobs[0].environment,'${{ parameters.environmentName }}');
 assert.deepEqual(deploy.dependsOn,['Plan','Review']);
 const steps=deploy.jobs[0].strategy.runOnce.deploy.steps;
 assert.ok(steps.some(s=>s.download==='current' && s.artifact==='application'));
 assert.ok(!JSON.stringify(steps).includes('content:publish'));
});
test('destroy is manually reviewed and demo is an independent opt-in pipeline',()=>{
 const operations=readFileSync('pipelines/operations.yml','utf8');
 assert.match(operations,/ManualValidation@1/);
 assert.match(operations,/dependsOn: ConfirmDestroy/);
 assert.match(operations,/environment: \$\{\{ parameters.environmentName \}\}/);
 const demo=readFileSync('pipelines/demo.yml','utf8');
 assert.match(demo,/trigger: none/);assert.match(demo,/allow_demo/);assert.match(demo,/ALLOW_DEMO_PUBLICATION=true/);
});

test('App Admin is a pipeline-managed role with separate assignments and scoped runtime writes', () => {
  const identity = readFileSync('infrastructure/identity.tf','utf8');
  assert.match(identity, /value\s*= "AppAdmin"/);
  assert.match(identity, /for_each\s*= var.app_admin_user_ids/);
  assert.match(identity, /display_name\s*= "App Admin"/);
  assert.match(readFileSync('infrastructure/variables.tf','utf8'), /variable "app_admin_user_ids"/);
});

test('directory lookup grants Graph read permission to the runtime managed identity', () => {
 const identity=readFileSync('infrastructure/identity.tf','utf8');
 assert.match(identity,/resource "azuread_app_role_assignment" "directory_reader"/);
 assert.match(identity,/principal_object_id\s*= azurerm_linux_function_app.api.identity\[0\].principal_id/);
 assert.match(identity,/microsoft_graph.app_role_ids\["User.Read.All"\]/);
 assert.ok(!identity.includes('app_role_ids["Directory.ReadWrite.All"]'));
});
