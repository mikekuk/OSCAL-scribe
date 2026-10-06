import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, validateConfig, terraformVariables } from '../../scripts/ci/config.mjs';
import { assertStateTarget } from '../../scripts/ci/terraform.mjs';
const config = validateConfig({subscription_id:'11111111-1111-1111-1111-111111111111',tenant_id:'22222222-2222-2222-2222-222222222222',resource_group_name:'rg-test',state_resource_group:'rg-state',state_storage_account:'sttestexample',state_key:'scribe.tfstate',location:'westus2',web_location:'westus2',prefix:'scribe',environment:'test',owner_object_ids:['33333333-3333-3333-3333-333333333333'],security_user_ids:['33333333-3333-3333-3333-333333333333'],user_ids:[],publisher_object_id:'',monthly_budget:35,budget_email:'alerts@example.com',budget_start:'2026-10-01T00:00:00Z',allow_demo:true});
const identity = '01234567-89ab-cdef-0123-456789abcdef';
test('every environment setting reaches Terraform; explicit owners and publisher are preserved', () => {
  const vars = terraformVariables(config,identity);
  assert.equal(vars.monthly_budget,config.monthly_budget);
  assert.equal(vars.budget_email,config.budget_email);
  assert.deepEqual(vars.security_user_ids,config.security_user_ids);
  assert.deepEqual(vars.owner_object_ids,[...config.owner_object_ids,identity]);
  assert.equal(vars.deployment_object_id,identity);
  assert.equal(vars.publisher_object_id,identity);
  assert.equal(terraformVariables({...config,publisher_object_id:config.owner_object_ids[0]},identity).publisher_object_id,config.owner_object_ids[0]);
});
test('configuration rejects accidental shared app/state group and invalid access lists', () => {
  assert.throws(()=>validateConfig({...config,state_resource_group:config.resource_group_name}),/separate/);
  assert.throws(()=>validateConfig({...config,security_user_ids:[]}),/Security/);
  assert.throws(()=>validateConfig({...config,user_ids:['not-an-object-id']}),/user_ids/);
  assert.throws(()=>validateConfig({...config,allow_demo:undefined}),/allow_demo/);
});
test('missing state fails closed for existing resources and routine operations', () => {
  assert.throws(()=>assertStateTarget(false,1,true),/State is missing/);
  assert.throws(()=>assertStateTarget(false,0,false),/State is missing/);
  assert.doesNotThrow(()=>assertStateTarget(false,0,true));
  assert.doesNotThrow(()=>assertStateTarget(true,10,false));
});

test('private cloud configuration overrides the intentionally incomplete public template',()=>{
 const old=process.env.SCRIBE_ENVIRONMENT_JSON;
 try {
  delete process.env.SCRIBE_ENVIRONMENT_JSON;
  assert.throws(()=>loadConfig('config/test.json'),/subscription_id/);
  process.env.SCRIBE_ENVIRONMENT_JSON=JSON.stringify(config);
  assert.deepEqual(loadConfig('config/test.json'),config);
 } finally {if(old===undefined)delete process.env.SCRIBE_ENVIRONMENT_JSON;else process.env.SCRIBE_ENVIRONMENT_JSON=old;}
});

test('App Admin assignments are explicit, validated and forwarded to Terraform', () => {
  assert.deepEqual(terraformVariables(config, identity).app_admin_user_ids, []);
  assert.deepEqual(terraformVariables(validateConfig({...config, app_admin_user_ids:[identity]}), identity).app_admin_user_ids, [identity]);
  assert.throws(() => validateConfig({...config, app_admin_user_ids:['invalid']}), /app_admin_user_ids/);
});

test('work dev config requires explicit identities and denies insecure settings', async()=>{
 const {readFileSync}=await import('node:fs');
 const template=JSON.parse(readFileSync('config/dev.json','utf8'));
 const dev={...template,subscription_id:config.subscription_id,tenant_id:config.tenant_id,owner_object_ids:config.owner_object_ids,security_user_ids:config.security_user_ids,infrastructure_object_id:'44444444-4444-4444-8444-444444444444',deployment_object_id:'55555555-5555-4555-8555-555555555555',publisher_object_id:'66666666-6666-4666-8666-666666666666'};
 assert.equal(validateConfig(dev).function_sku,'EP1');
 for(const change of [{typo:true},{allow_demo:true},{private_data:false},{allow_localhost_redirect:true},{publisher_object_id:''},{publisher_object_id:dev.deployment_object_id},{owner_object_ids:[dev.deployment_object_id]}]) assert.throws(()=>validateConfig({...dev,...change}));
 const vars=terraformVariables(validateConfig(dev),dev.infrastructure_object_id);
 assert.equal(vars.deployment_object_id,dev.deployment_object_id);assert.equal(vars.publisher_object_id,dev.publisher_object_id);
 assert.ok(vars.owner_object_ids.includes(dev.infrastructure_object_id));assert.ok(!vars.owner_object_ids.includes(dev.deployment_object_id));
 const old=process.env.SCRIBE_ENVIRONMENT_JSON;
 try {process.env.SCRIBE_ENVIRONMENT_JSON=JSON.stringify(config);assert.throws(()=>loadConfig('config/dev.json'),/does not match/);}
 finally {if(old===undefined)delete process.env.SCRIBE_ENVIRONMENT_JSON;else process.env.SCRIBE_ENVIRONMENT_JSON=old;}
 assert.throws(()=>validateConfig({...dev,environment:'prod',allow_destroy:true,protect_data:false}));
 assert.doesNotThrow(()=>validateConfig({...dev,allow_destroy:true,protect_data:false}));
});
