import {readFileSync,writeFileSync} from 'node:fs';
import {loadConfig} from './config.mjs';
const c = loadConfig();
writeFileSync('work/ci/deployment.json', JSON.stringify({commit:process.env.BUILD_SOURCEVERSION,environment:c.environment,subscription:c.subscription_id,tenant:c.tenant_id,resourceGroup:c.resource_group_name,outputs:JSON.parse(readFileSync('work/ci/outputs.json','utf8'))}));
