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
test('main builds safely, explicit deployments verify artifacts, PRs are excluded, infrastructure approval and shared lock remain',()=>{
 const d=parseDocument(readFileSync('azure-pipelines.yml','utf8')).toJS();
 assert.deepEqual(d.trigger.branches.include,['main']);
 assert.equal(d.parameters.find(p=>p.name==='deploy').default,false);
 const stages=Object.values(d.stages[1])[0];
 assert.match(stages.find(s=>s.stage==='Plan').condition,/ne\(variables\['Build.Reason'\], 'PullRequest'\)/);
 assert.match(stages.find(s=>s.stage==='Review').condition,/hasChanges/);
 const deploy=stages.find(s=>s.stage==='Deploy');
 assert.equal(deploy.lockBehavior,'sequential');
 assert.match(deploy.jobs[0].environment,/variables.scribeDeploymentEnvironment/);
 assert.deepEqual(deploy.dependsOn,['Plan','Review']);
 const steps=deploy.jobs[0].strategy.runOnce.deploy.steps;
 assert.ok(steps.some(s=>s.download==='current' && s.artifact==='application'));
 assert.ok(!JSON.stringify(steps).includes('content:publish'));
});
test('destroy is manually reviewed and demo is an independent opt-in pipeline',()=>{
 const operations=readFileSync('pipelines/operations.yml','utf8');
 assert.match(operations,/ManualValidation@1/);
 assert.match(operations,/dependsOn: ConfirmDestroy/);
 assert.match(operations,/environment:.*scribeDeploymentEnvironment/);
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

test('work deployment keeps infra and code under one environment lock with separate identities and network pools',()=>{
 const d=parseDocument(readFileSync('azure-pipelines.yml','utf8')).toJS();
 const stages=Object.values(d.stages[1])[0], deploy=stages.find(s=>s.stage==='Deploy');
 const app=Object.values(deploy.jobs[1])[0][0];
 assert.equal(app.deployment,'Application');assert.equal(app.dependsOn,'Deploy');
 assert.equal(app.environment,deploy.jobs[0].environment);
 assert.match(JSON.stringify(app.pool),/devAgentPool/);
 const steps=app.strategy.runOnce.deploy.steps;
 const azure=steps.find(s=>s.template==='pipelines/templates/azure-step.yml');
 assert.equal(azure.parameters.role,'deployment');
 assert.match(azure.parameters.serviceConnection,/deploymentServiceConnection/);
 const swa=steps.find(s=>s.task==='AzureStaticWebApp@0');
 assert.equal(swa.inputs.skip_app_build,true);assert.equal(swa.inputs.skip_api_build,true);
 const content=parseDocument(readFileSync('pipelines/content.yml','utf8')).toJS();
 assert.equal(content.parameters.find(p=>p.name==='contentSource').default,'nist-reference');
 assert.equal(content.steps.find(s=>s.template==='templates/azure-step.yml').parameters.role,'publisher');
});

// Guard the provider boundary missed by mock Terraform plans: hosted infra cannot
// poll private storage endpoints or depend on shared keys disabled by the module.
test('storage provisioning uses ARM while shared keys remain disabled',()=>{
 const provider=readFileSync('infrastructure/main.tf','utf8');
 assert.match(provider,/features\s*\{\s*storage\s*\{[^}]*data_plane_available\s*=\s*false/s);
 assert.match(provider,/storage_use_azuread\s*=\s*true/);
 const resources=readFileSync('infrastructure/functions.tf','utf8');
 assert.equal((resources.match(/shared_access_key_enabled\s*=\s*false/g)||[]).length,2);
 const container=resources.match(/resource "azurerm_storage_container" "packages"\s*\{([^}]+)\}/s)[1];
 assert.match(container,/storage_account_id\s*=\s*azurerm_storage_account.packages.id/);
 assert.doesNotMatch(container,/storage_account_name\s*=/);
 assert.doesNotMatch(resources,/^\s*(queue_properties|static_website)\s*\{/m);
});

test('all pipelines use shared profile defaults and build-only runs do not request secrets', () => {
 const main = parseDocument(readFileSync('azure-pipelines.yml', 'utf8')).toJS();
 assert.equal(main.variables[0].parameters.loadSecrets, '${{ parameters.deploy }}');
 for (const file of files.filter(f => !f.includes('/templates/'))) {
  const pipeline = parseDocument(readFileSync(file, 'utf8')).toJS();
  assert.match(pipeline.variables[0].template, /templates\/profile.yml$/);
  assert.equal(pipeline.parameters.find(p => p.name === 'configFile').default, 'config/test.json');
 }
 const profile = parseDocument(readFileSync('pipelines/templates/profile.yml', 'utf8')).toJS();
 const branches = profile.variables;
 const dev = Object.values(branches[0])[0];
 const personal = Object.values(branches[1])[0];
 const values = entries => Object.fromEntries(entries.map(v => [v.name, v.value]));
 assert.equal(values(dev).scribeInfrastructureConnection, 'oscal-scribe-dev-infrastructure');
 assert.equal(values(dev).scribeDeploymentConnection, 'oscal-scribe-dev-deployment');
 assert.equal(values(dev).scribePublisherConnection, 'oscal-scribe-dev-publisher');
 assert.equal(values(dev).scribeDeploymentEnvironment, 'scribe-dev');
 assert.equal(values(dev).scribeDataAgentPool, 'scribe-dev-agents');
 assert.equal(values(personal).scribeInfrastructureConnection, 'oscal-scribe-azure');
 assert.equal(values(personal).scribeDeploymentEnvironment, 'scribe-test');
 assert.match(Object.keys(branches[2])[0], /eq\(parameters.loadSecrets, true\)/);
 const azure = parseDocument(readFileSync('pipelines/templates/azure-step.yml', 'utf8')).toJS();
 for (const [role, variable] of [['infrastructure', 'Infrastructure'], ['deployment', 'Deployment'], ['publisher', 'Publisher']]) {
  const branch = azure.steps[0].inputs[`\${{ if eq(parameters.role, '${role}') }}`];
  assert.equal(branch.azureSubscription, `\${{ coalesce(parameters.serviceConnection, variables.scribe${variable}Connection) }}`);
 }
});
