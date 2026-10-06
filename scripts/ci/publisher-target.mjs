import {loadConfig,assertIdentity,az} from './config.mjs';
const c=loadConfig(); assertIdentity(c,'publisher');
const accounts=az(['cosmosdb','list','--resource-group',c.resource_group_name]);
if (accounts.length !== 1) throw Error('Expected exactly one Cosmos account in the selected Scribe resource group');
console.log(accounts[0].documentEndpoint);
