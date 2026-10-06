import {verifyArtifact} from './ci/artifact-integrity.mjs';
import { loadConfig, assertIdentity } from './ci/config.mjs';
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, rmSync, cpSync } from "node:fs";
import { createHash } from "node:crypto";
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", ...options });
const config = loadConfig(); assertIdentity(config, 'deployment');
const target = JSON.parse(readFileSync(process.argv[3], 'utf8'));
if (target.commit !== process.env.BUILD_SOURCEVERSION || target.environment !== config.environment || target.subscription !== config.subscription_id || target.tenant !== config.tenant_id || target.resourceGroup !== config.resource_group_name) throw Error('Deployment artifact targets a different commit or environment');
const output = target.outputs, v = k => output[k].value;
if (v('environment') !== config.environment || v('subscription_id') !== config.subscription_id || v('tenant_id') !== config.tenant_id || v('resource_group') !== config.resource_group_name) throw Error('Terraform outputs do not match selected profile');
const artifact = process.argv[2];
if (!artifact) throw Error("Pass the downloaded Azure Pipelines application artifact directory");
const provenance = JSON.parse(readFileSync(`${artifact}/provenance.json`, "utf8"));
if (process.env.BUILD_SOURCEVERSION && provenance.commit !== process.env.BUILD_SOURCEVERSION)
  throw Error("Application artifact does not match this pipeline commit");
verifyArtifact(artifact, provenance);
mkdirSync("work", { recursive: true });
rmSync("work/deploy-web", { recursive: true, force: true });
cpSync(`${artifact}/web`, "work/deploy-web", { recursive: true });
writeFileSync("work/deploy-web/config.json", JSON.stringify({tenantId:v("tenant_id"),clientId:v("client_id")}));
const apiZip = `${artifact}/api.zip`;
const name =
  createHash("sha256").update(readFileSync(apiZip)).digest("hex") +
  ".zip";
const exists = JSON.parse(run("az", ["storage","blob","exists","--account-name",v("storage_account"),"--container-name","packages","--name",name,"--auth-mode","login","--output","json"])).exists;
if (exists) {
  run("az", ["storage","blob","download","--account-name",v("storage_account"),"--container-name","packages","--name",name,"--file","work/existing-api.zip","--auth-mode","login","--overwrite","true","--output","none"]);
  if (createHash("sha256").update(readFileSync("work/existing-api.zip")).digest("hex") + ".zip" !== name) throw Error("Existing deployment package digest mismatch");
} else run("az", [
  "storage",
  "blob",
  "upload",
  "--account-name",
  v("storage_account"),
  "--container-name",
  "packages",
  "--name",
  name,
  "--file",
  apiZip,
  "--auth-mode",
  "login",
  "--overwrite",
  "false",
  "--output",
  "none",
]);
console.log("Package uploaded; configuring managed-identity runtime");
const packageUrl = `https://${v("storage_account")}.blob.core.windows.net/packages/${name}`;
run("az", [
  "functionapp",
  "config",
  "appsettings",
  "set",
  "--resource-group",
  v("resource_group"),
  "--name",
  v("function_name"),
  "--settings",
  JSON.stringify({ WEBSITE_RUN_FROM_PACKAGE: packageUrl }),
  "--output",
  "none",
]);
run("az", [
  "functionapp",
  "restart",
  "--resource-group",
  v("resource_group"),
  "--name",
  v("function_name"),
]);
// External package URLs require trigger synchronization, including the first deployment.
// Retry while the restarted host mounts its package and managed-identity grants propagate.
const siteId = `/subscriptions/${config.subscription_id}/resourceGroups/${config.resource_group_name}/providers/Microsoft.Web/sites/${v("function_name")}`;
for (let attempt = 0; ; attempt++) {
  try {
    run("az", ["rest", "--method", "post", "--url", `https://management.azure.com${siteId}/syncfunctiontriggers?api-version=2024-11-01`, "--output", "none"], {stdio:["ignore","pipe","pipe"]});
    break;
  } catch {
    if (attempt === 11) throw Error("Function trigger synchronization failed; check package access and host startup before retrying deployment");
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }
}
console.log("Deploying the static web app");
// Capture the token privately, then pass it through the masked pipeline variable.
const token = JSON.parse(
  run("az", [
    "staticwebapp",
    "secrets",
    "list",
    "--name",
    v("web_name"),
    "--resource-group",
    v("resource_group"),
    "--output",
    "json",
  ]),
).properties.apiKey;
// Azure Pipelines masks this value and passes it only to its official SWA deployment task.
if (!/^[A-Za-z0-9._+/=-]+$/.test(token)) throw Error('Unexpected SWA deployment token format');
console.log('##vso[task.setvariable variable=ScribeSwaDeploymentToken;issecret=true]' + token);
console.log('##vso[task.setvariable variable=ScribeWebUrl]' + v('web_url'));
console.log('API package configured; prepared web artifact for AzureStaticWebApp@0.');
