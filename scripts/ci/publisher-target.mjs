import {pathToFileURL} from 'node:url';
import {loadConfig,assertIdentity,az} from './config.mjs';

export function publisherEndpoint(accounts, resourceGroup) {
  if (accounts.length === 0) throw Error(`No Cosmos account found in resource group ${resourceGroup}. Backend setup creates only Terraform state storage. Run Build and deploy with deploy=true and the same configFile/variableGroup, and verify its infrastructure deployment succeeds before publishing content. If already deployed, check the selected resource group and publisher access.`);
  if (accounts.length !== 1) throw Error(`Found ${accounts.length} Cosmos accounts in resource group ${resourceGroup}; expected exactly one. Check the selected configFile/variableGroup and resource group. Refusing to choose a publication target automatically.`);
  const endpoint = accounts[0].documentEndpoint;
  let url;
  try { url = new URL(endpoint); } catch { throw Error('The selected Cosmos account has no valid document endpoint; check its provisioning state before publishing content.'); }
  if (url.protocol !== 'https:') throw Error('The selected Cosmos account must have an HTTPS document endpoint.');
  return endpoint;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const c=loadConfig(); assertIdentity(c,'publisher');
  const accounts=az(['cosmosdb','list','--resource-group',c.resource_group_name]);
  console.log(publisherEndpoint(accounts,c.resource_group_name));
}
