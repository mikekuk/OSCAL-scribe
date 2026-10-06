import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export const defaults = { vnet_cidr: '10.42.0.0/16', deployment_object_id: '', infrastructure_object_id: '', allow_localhost_redirect: true, allow_raw_browser: false, allow_permanent_delete: false, allow_destroy: false, private_data: false, function_sku: 'Y1', requests_per_minute: 120, expensive_requests_per_minute: 10, log_retention_days: 30, log_daily_cap_gb: 0.1, backup_retention_days: 7, protect_data: true };
const known = new Set([...Object.keys(defaults), 'subscription_id','tenant_id','resource_group_name','state_resource_group','state_storage_account','state_key','location','web_location','prefix','environment','owner_object_ids','security_user_ids','user_ids','publisher_object_id','monthly_budget','budget_email','budget_start','allow_demo','app_admin_user_ids']);
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateConfig(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw Error('Configuration must be an object');
  for (const k of Object.keys(c)) if (!known.has(k)) throw Error(`Unknown configuration setting: ${k}`);
  const supplied = c;
  c = {...defaults, ...c};
  if (!['test','dev','prod'].includes(c.environment)) throw Error('Environment must be test, dev or prod');
  if (c.environment !== 'test') for (const k of Object.keys(defaults)) if (!(k in supplied)) throw Error(`Explicit ${k} required outside test`);
  for (const k of ['allow_localhost_redirect','allow_raw_browser','allow_permanent_delete','allow_destroy','private_data','protect_data']) if (typeof c[k] !== 'boolean') throw Error(`Invalid ${k}`);
  for (const k of ['deployment_object_id','infrastructure_object_id']) if (c[k] !== '' && (!guid.test(c[k]) || /^0+-0+-0+-0+-0+$/.test(c[k]))) throw Error(`Invalid ${k}`);
  if (!/^(?:[0-9]{1,3}\.){3}0\/16$/.test(c.vnet_cidr) || c.vnet_cidr.split('/')[0].split('.').some(x => Number(x)>255) || c.vnet_cidr.split('.')[2] !== '0') throw Error('vnet_cidr must be a canonical IPv4 /16');
  if (!['Y1','EP1'].includes(c.function_sku) || (c.private_data && c.function_sku !== 'EP1')) throw Error('Private data requires EP1 hosting');
  for (const [k,min,max] of [['requests_per_minute',10,1000],['expensive_requests_per_minute',1,100],['log_retention_days',30,730]]) if (!Number.isInteger(c[k]) || c[k]<min || c[k]>max) throw Error(`Invalid ${k}`);
  if (c.expensive_requests_per_minute > c.requests_per_minute) throw Error('Expensive request limit exceeds total');
  if (!Number.isFinite(c.log_daily_cap_gb) || c.log_daily_cap_gb < 0.1 || c.log_daily_cap_gb > 100) throw Error('Invalid log_daily_cap_gb');
  if (![7,30].includes(c.backup_retention_days)) throw Error('Invalid backup_retention_days');
  if (c.environment !== 'test') {
    if (c.allow_demo || c.allow_localhost_redirect || !c.private_data || (!c.protect_data && !c.allow_destroy)) throw Error('Work environments require private data, protection, no demo and no localhost redirect');
    const identities = [c.infrastructure_object_id,c.deployment_object_id,c.publisher_object_id];
    if (identities.some(x => !guid.test(x) || /^0+-0+-0+-0+-0+$/.test(x)) || new Set(identities).size !== 3) throw Error('Work environments require three distinct explicit pipeline identities');
    if (c.owner_object_ids?.includes(c.deployment_object_id) || c.owner_object_ids?.includes(c.publisher_object_id)) throw Error('Deployment and publisher identities cannot own the application');
  }
  if (c.environment === 'prod' && (!c.protect_data || c.allow_raw_browser || c.allow_permanent_delete || c.allow_destroy || c.log_retention_days < 90 || c.backup_retention_days !== 30)) throw Error('Production policy forbids raw browsing/destruction and requires 90-day logs and 30-day backup');
  for (const k of ['subscription_id', 'tenant_id']) if (!guid.test(c[k]) || c[k] === '00000000-0000-0000-0000-000000000000') throw Error(`Invalid ${k}`);
  for (const k of ['resource_group_name','state_resource_group']) if (!/^[a-zA-Z0-9_-]{1,90}$/.test(c[k])) throw Error(`Invalid ${k}`);
  if (c.resource_group_name === c.state_resource_group) throw Error('State must have a separate resource group');
  if (!/^[a-z0-9]{3,24}$/.test(c.state_storage_account)) throw Error('Invalid state storage account');
  if (!/^[a-zA-Z0-9_.-]+\.tfstate$/.test(c.state_key)) throw Error('Invalid state key');
  for (const k of ['location','web_location','prefix','environment']) if (!/^[a-z][a-z0-9-]{1,29}$/.test(c[k])) throw Error(`Invalid ${k}`);
  c.app_admin_user_ids ??= [];
  for (const k of ['app_admin_user_ids','owner_object_ids','security_user_ids','user_ids']) if (!Array.isArray(c[k]) || c[k].some(v => !guid.test(v) || /^0+-0+-0+-0+-0+$/.test(v))) throw Error(`Invalid ${k}`);
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
  const template = JSON.parse(readFileSync(file, 'utf8'));
  const effective = privateConfig ? JSON.parse(privateConfig) : template;
  if (effective.environment !== template.environment) throw Error('Selected config profile does not match protected environment JSON');
  return validateConfig(effective);
}
export function terraformVariables(c, pipelineObjectId) {
  if (!guid.test(pipelineObjectId)) throw Error('Invalid pipeline object ID');
  const keys = ['subscription_id','tenant_id','resource_group_name','web_location','prefix','environment','security_user_ids','user_ids','app_admin_user_ids','monthly_budget','budget_email','budget_start', ...Object.keys(defaults).filter(k => !['deployment_object_id','infrastructure_object_id'].includes(k))];
  return {...Object.fromEntries(keys.map(k => [k,c[k]])),
    owner_object_ids: [...new Set([...c.owner_object_ids,c.infrastructure_object_id || pipelineObjectId])],
    deployment_object_id: c.deployment_object_id || pipelineObjectId,
    publisher_object_id: c.publisher_object_id || pipelineObjectId};
}
export const az = args => JSON.parse(execFileSync('az', [...args,'--output','json','--only-show-errors'], {encoding:'utf8'}));
export function assertAccount(c) {
  const account = az(['account','show']);
  if (account.id !== c.subscription_id || account.tenantId !== c.tenant_id) throw Error('Service connection does not match configuration subscription/tenant');
}
// Identity comes from the Azure CLI's authenticated ARM token; no Graph directory-read grant is needed.
export function assertIdentity(c, role) {
  assertAccount(c);
  const token = az(['account','get-access-token','--resource','https://management.azure.com/']).accessToken;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  if (!guid.test(claims.oid)) throw Error('Cannot identify service connection');
  const expected = c[role + '_object_id'];
  if (expected && expected !== claims.oid) throw Error(`Wrong ${role} service connection`);
  if (c.environment !== 'test' && !expected) throw Error(`Explicit ${role} identity required`);
  return claims.oid;
}
export function configure() {
  const c = loadConfig(); assertAccount(c);
  const objectId = assertIdentity(c, 'infrastructure');
  mkdirSync('work/ci', {recursive:true});
  writeFileSync('work/ci/deployment.tfvars.json', JSON.stringify(terraformVariables(c,objectId),null,2), {mode:0o600});
  writeFileSync('work/ci/backend.hcl', Object.entries({resource_group_name:c.state_resource_group,storage_account_name:c.state_storage_account,container_name:'tfstate',key:c.state_key,use_azuread_auth:true,use_oidc:true}).map(([k,v])=>`${k} = ${JSON.stringify(v)}`).join('\n'));
  return c;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) configure();
