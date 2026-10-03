import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateConfig(c) {
  for (const k of ['subscription_id', 'tenant_id']) if (!guid.test(c[k]) || c[k] === '00000000-0000-0000-0000-000000000000') throw Error(`Invalid ${k}`);
  for (const k of ['resource_group_name','state_resource_group']) if (!/^[a-zA-Z0-9_-]{1,90}$/.test(c[k])) throw Error(`Invalid ${k}`);
  if (c.resource_group_name === c.state_resource_group) throw Error('State must have a separate resource group');
  if (!/^[a-z0-9]{3,24}$/.test(c.state_storage_account)) throw Error('Invalid state storage account');
  if (!/^[a-zA-Z0-9_.-]+\.tfstate$/.test(c.state_key)) throw Error('Invalid state key');
  for (const k of ['location','web_location','prefix','environment']) if (!/^[a-z][a-z0-9-]{1,29}$/.test(c[k])) throw Error(`Invalid ${k}`);
  for (const k of ['owner_object_ids','security_user_ids','user_ids']) if (!Array.isArray(c[k]) || c[k].some(v => !guid.test(v))) throw Error(`Invalid ${k}`);
  if (!c.owner_object_ids.length || !c.security_user_ids.length) throw Error('Set at least one owner and Security user');
  if (c.publisher_object_id !== '' && !guid.test(c.publisher_object_id)) throw Error('Invalid publisher identity');
  if (!(Number.isFinite(c.monthly_budget) && c.monthly_budget > 0)) throw Error('Set a positive budget in subscription billing currency');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.budget_email)) throw Error('Set the budget alert email');
  if (!/^\d{4}-\d{2}-01T00:00:00Z$/.test(c.budget_start) || Number.isNaN(Date.parse(c.budget_start))) throw Error('Budget start must be the first of a month');
  if (typeof c.allow_demo !== 'boolean') throw Error('Set allow_demo explicitly');
  return c;
}
export function loadConfig(file = process.env.SCRIBE_CONFIG || 'config/test.json') {
  const privateConfig = process.env.SCRIBE_ENVIRONMENT_JSON;
  if (privateConfig?.startsWith('$(')) throw Error('Authorize the variable group and set secret scribeEnvironment JSON');
  return validateConfig(JSON.parse(privateConfig || readFileSync(file, 'utf8')));
}
export function terraformVariables(c, pipelineObjectId) {
  if (!guid.test(pipelineObjectId)) throw Error('Invalid pipeline object ID');
  const keys = ['subscription_id','tenant_id','resource_group_name','web_location','prefix','environment','security_user_ids','user_ids','monthly_budget','budget_email','budget_start'];
  return {...Object.fromEntries(keys.map(k => [k,c[k]])),
    owner_object_ids: [...new Set([...c.owner_object_ids,pipelineObjectId])],
    deployment_object_id: pipelineObjectId,
    publisher_object_id: c.publisher_object_id || pipelineObjectId};
}
export const az = args => JSON.parse(execFileSync('az', [...args,'--output','json','--only-show-errors'], {encoding:'utf8'}));
export function assertAccount(c) {
  const account = az(['account','show']);
  if (account.id !== c.subscription_id || account.tenantId !== c.tenant_id) throw Error('Service connection does not match configuration subscription/tenant');
}
export function configure() {
  const c = loadConfig(); assertAccount(c);
  const sp = az(['ad','sp','show','--id',process.env.ARM_CLIENT_ID]);
  mkdirSync('work/ci', {recursive:true});
  writeFileSync('work/ci/deployment.tfvars.json', JSON.stringify(terraformVariables(c,sp.id),null,2), {mode:0o600});
  writeFileSync('work/ci/backend.hcl', Object.entries({resource_group_name:c.state_resource_group,storage_account_name:c.state_storage_account,container_name:'tfstate',key:c.state_key,use_azuread_auth:true,use_oidc:true}).map(([k,v])=>`${k} = ${JSON.stringify(v)}`).join('\n'));
  return c;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) configure();
