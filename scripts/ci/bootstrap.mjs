// One-time cloud bootstrap. No Terraform and no local state are used here.
import { createHash } from 'node:crypto';
import { loadConfig, assertAccount, az } from './config.mjs';
const c = loadConfig(); assertAccount(c);
const principal = az(['ad','sp','show','--id',process.env.ARM_CLIENT_ID]).id;
for (const group of [c.resource_group_name,c.state_resource_group]) {
  if (!az(['group','exists','--name',group])) throw Error(`Create resource group ${group} in the portal first`);
}
const accounts = az(['storage','account','list','--resource-group',c.state_resource_group]);
const old = accounts.find(a=>a.name === c.state_storage_account);
if (old && old.tags?.application !== 'OSCAL-Scribe-state') throw Error('Refusing to modify a storage account without the Scribe state ownership tag');
az(['storage','account','create','--resource-group',c.state_resource_group,'--name',c.state_storage_account,'--location',c.location,'--sku','Standard_LRS','--kind','StorageV2','--https-only','true','--min-tls-version','TLS1_2','--allow-blob-public-access','false','--allow-shared-key-access','false','--tags','application=OSCAL-Scribe-state']);
const account = az(['storage','account','show','--resource-group',c.state_resource_group,'--name',c.state_storage_account]);
az(['storage','account','blob-service-properties','update','--resource-group',c.state_resource_group,'--account-name',c.state_storage_account,'--enable-versioning','true','--enable-delete-retention','true','--delete-retention-days','30','--enable-container-delete-retention','true','--container-delete-retention-days','30']);
// Create the private container through ARM: no account keys or temporary broad data role.
az(['rest','--method','put','--url',`https://management.azure.com${account.id}/blobServices/default/containers/tfstate?api-version=2023-05-01`,'--body',JSON.stringify({properties:{publicAccess:'None'}})]);
const scope = `${account.id}/blobServices/default/containers/tfstate`;
const digest = createHash('sha256').update(`${scope}/${principal}/state-contributor`).digest('hex');
const roleId = `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
az(['role','assignment','create','--name',roleId,'--assignee-object-id',principal,'--assignee-principal-type','ServicePrincipal','--role','Storage Blob Data Contributor','--scope',scope]);
console.log(`Backend ready: ${c.state_storage_account}/tfstate/${c.state_key}. No application resources deployed. Allow a few minutes for role propagation.`);
