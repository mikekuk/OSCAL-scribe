import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from './config.mjs';
import { assertDeploymentTarget } from './deployment-target.mjs';

const config = loadConfig();
const target = {
  commit: process.env.BUILD_SOURCEVERSION,
  environment: config.environment,
  subscription: config.subscription_id,
  tenant: config.tenant_id,
  resourceGroup: config.resource_group_name,
  outputs: JSON.parse(readFileSync('work/ci/outputs.json', 'utf8')),
};
// Verify what we publish as well as what the separate deployment job consumes.
assertDeploymentTarget(target, config, process.env.BUILD_SOURCEVERSION);
writeFileSync('work/ci/deployment.json', JSON.stringify(target));
