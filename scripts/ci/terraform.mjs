import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { configure, az } from './config.mjs';
export function assertStateTarget(exists, resourceCount, allowNew) {
  if (!exists && (!allowNew || resourceCount > 0)) throw Error('State is missing. Only a first deployment into an empty resource group may create state. Restore the correct backend; do not import or recreate automatically.');
}
export function initialize() {
const c = configure();
const exists = az(['storage','blob','exists','--account-name',c.state_storage_account,'--container-name','tfstate','--name',c.state_key,'--auth-mode','login']).exists;
// Also checks access to the intended application resource group.
const resources = az(['resource','list','--resource-group',c.resource_group_name]);
assertStateTarget(exists,resources.length,process.argv.includes('--allow-new'));
execFileSync('terraform',['-chdir=infrastructure','init','-input=false','-lockfile=readonly','-backend-config=../work/ci/backend.hcl'],{stdio:'inherit'});

}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) initialize();
