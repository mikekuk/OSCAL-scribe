import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", ...options });
const output = JSON.parse(
    run("terraform", ["-chdir=infrastructure", "output", "-json"]),
  ),
  v = (k) => output[k].value;
run("npm", ["run", "build"], { stdio: "inherit" });
writeFileSync(
  "dist/web/config.json",
  JSON.stringify({ tenantId: v("tenant_id"), clientId: v("client_id") }),
);
// Runtime dependencies are installed from the committed lockfile, then development packages pruned.
mkdirSync("work/api-package", { recursive: true });
run("cp", ["dist/api/functions.js", "dist/api/host.json", "work/api-package/"]);
run("cp", ["package.json", "package-lock.json", "work/api-package/"]);
const pkg = JSON.parse(readFileSync("work/api-package/package.json", "utf8"));
pkg.main = "functions.js";
writeFileSync("work/api-package/package.json", JSON.stringify(pkg));
run("npm", ["ci", "--omit=dev", "--ignore-scripts"], {
  cwd: "work/api-package",
  stdio: "inherit",
});
run("zip", ["-qr", "../api.zip", "."], { cwd: "work/api-package" });
const name =
  createHash("sha256").update(readFileSync("work/api.zip")).digest("hex") +
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
  "work/api.zip",
  "--auth-mode",
  "login",
  "--overwrite",
  "true",
  "--output",
  "none",
]);
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
  "WEBSITE_RUN_FROM_PACKAGE=" + packageUrl,
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
    "dist/web",
    "--env",
    "production",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, SWA_CLI_DEPLOYMENT_TOKEN: token },
  },
);
console.log(
  "Deployed " +
    v("web_url") +
    "; run post-deployment checks and Entra sign-in acceptance tests.",
);
