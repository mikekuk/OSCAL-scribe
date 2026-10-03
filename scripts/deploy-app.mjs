import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, rmSync, cpSync } from "node:fs";
import { createHash } from "node:crypto";
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", ...options });
const output = JSON.parse(
    run("terraform", ["-chdir=infrastructure", "output", "-json"]),
  ),
  v = (k) => output[k].value;
const artifact = process.argv[2];
if (!artifact) throw Error("Pass the downloaded Azure Pipelines application artifact directory");
const provenance = JSON.parse(readFileSync(`${artifact}/provenance.json`, "utf8"));
if (process.env.BUILD_SOURCEVERSION && provenance.commit !== process.env.BUILD_SOURCEVERSION)
  throw Error("Application artifact does not match this pipeline commit");
mkdirSync("work", { recursive: true });
rmSync("work/deploy-web", { recursive: true, force: true });
cpSync(`${artifact}/web`, "work/deploy-web", { recursive: true });
writeFileSync("work/deploy-web/config.json", JSON.stringify({tenantId:v("tenant_id"),clientId:v("client_id")}));
const apiZip = `${artifact}/api.zip`;
const name =
  createHash("sha256").update(readFileSync(apiZip)).digest("hex") +
  ".zip";
run("az", [
  "storage",
  "container",
  "create",
  "--account-name",
  v("storage_account"),
  "--name",
  "packages",
  "--auth-mode",
  "login",
  "--output",
  "none",
]);
run("az", [
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
  "true",
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
console.log("Deploying the static web app");
// Deployment token is kept in child process environment, never printed or written to source.
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
run(
  "npx",
  [
    "--yes",
    "@azure/static-web-apps-cli@2.0.8",
    "deploy",
    "work/deploy-web",
    "--env",
    "production",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, SWA_CLI_DEPLOYMENT_TOKEN: token },
  },
);
run("node", ["scripts/smoke.mjs"], {
  stdio: "inherit",
  env: { ...process.env, SCRIBE_URL: v("web_url") },
});
console.log(
  "Deployed " +
    v("web_url") +
    "; run post-deployment checks and Entra sign-in acceptance tests.",
);
