# Azure deployment, shutdown and rebuild runbook

This runbook covers the personal test bed and the changes needed for a separate Azure environment. All commands run from the **OSCAL-scribe repository root**, using Bash or Zsh. Replace values in angle brackets. Documentation commands do not execute themselves: the existing test bed remains running until you deliberately stop or delete it.

## Choose the operation

| What you want | Procedure | What happens to data and charges |
| --- | --- | --- |
| Temporarily make Scribe unavailable | [Stop and restart](#stop-and-restart-without-deleting-data) | SSPs remain. Other Azure resources can still incur charges. |
| Remove the test bed | [Delete the deployment](#delete-the-deployment) | Removes deployed resources and Entra objects managed by this Terraform state. Back up data first. |
| Update/rebuild the code in the existing environment | [Redeploy the application](#redeploy-the-application-in-the-existing-environment) | Replaces application code; retains Cosmos data and identities. |
| Recreate a deleted environment | [Build from a fresh clone](#build-from-a-fresh-clone) | Creates an empty environment. Git does not contain saved SSPs. |
| Deploy into company Azure or another subscription | [Different Azure environment](#deploy-into-a-different-azure-environment) | Separate state, resources, identities, assignments and content are required. |
| Add/remove people or understand permissions | [Permissions guide](permissions.md) | Enterprise app assignments control entry; SSP sharing controls individual plans. |

Infrastructure, application code and controlled OSCAL content are **three separate deployment steps**. Azure DevOps is optional for the manual steps below; the repository does not create an Azure DevOps organization or service connections.

## Find the current deployment and identity

The original personal test bed uses resource group `rg-oscal-scribe-test` in West US 2. Its web and Function apps are named `oscal-scribe-u72bee`. The Entra app registration **and** Enterprise application are named `oscal-scribe-u72bee test`; they exist at the directory level, not inside that resource group. See [how to find them](permissions.md#find-the-app-registration-and-enterprise-application).

Use the existing deployment checkout and its Terraform state:

```sh
az account show --query '{subscription:id,tenant:tenantId,name:name}' -o table
terraform -chdir=infrastructure output
terraform -chdir=infrastructure state list
```

Check that the subscription and directory match the ignored `infrastructure/test.tfvars` file. For the original Codex-created checkout, the authenticated CLI cache was kept in `../work/azure`. If using that existing login, set `AZURE_CONFIG_DIR` to the absolute path of that directory **before** running Azure or Terraform commands. On a new machine, use your own `az login`; do not copy authentication caches.

The personal subscription bills in GBP. Its private tfvars uses a **£35 monthly alert budget**, with notifications at £17.50, £28 and £35. This allows some room below the requested US$50 target, subject to exchange rates and taxes. The budget covers this resource group, not the entire subscription. [Azure budgets send alerts; they do not stop spending](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets).

### Preserve the deployment record

Keep the following in protected storage outside the resource group you might delete:

- The Git commit used, `package-lock.json` and `infrastructure/.terraform.lock.hcl`.
- The environment's private tfvars and backend configuration.
- Terraform state, or access to its remote backend and version history.
- The exact approved content source commit and published release artifacts.
- A tested data backup if saved SSPs, sharing, attestation or history must survive deletion.

State can contain sensitive resource attributes. Never commit state, plans, credentials or private tfvars. A local snapshot can be taken with:

```sh
umask 077
mkdir -p work/deployment-backup
terraform -chdir=infrastructure state pull > work/deployment-backup/terraform.tfstate
terraform -chdir=infrastructure output -json > work/deployment-backup/outputs.json
git rev-parse HEAD > work/deployment-backup/commit.txt
cp infrastructure/test.tfvars work/deployment-backup/test.tfvars
```

Move the backup to protected storage before discarding this checkout. `work/` is ignored by Git; a fresh clone will not contain it. A Terraform state backup describes resources; **it is not a Cosmos data backup**.

## Stop and restart without deleting data

Use this for a temporary maintenance pause. Confirm the account first, then capture the names from the correct state:

```sh
scribe_rg=$(terraform -chdir=infrastructure output -raw resource_group)
scribe_api=$(terraform -chdir=infrastructure output -raw function_name)
az account show --query '{subscription:id,tenant:tenantId}' -o table
az functionapp stop --resource-group "$scribe_rg" --name "$scribe_api"
az functionapp show --resource-group "$scribe_rg" --name "$scribe_api" --query state -o tsv
```

Portal equivalent: open **Azure portal → Resource groups → the Scribe group → the Function App → Overview → Stop**. Use **Start** in the same place to resume. Do not confuse the Function App with the Static Web App or the Consumption plan.

Expect `Stopped`. The public Static Web Apps page can still load, but Scribe's backend cannot serve plans. Stopping the Function App does not delete Cosmos, storage, the Static Web App, telemetry or Entra objects. It also does not stop another publisher identity writing controlled content. Pause any Azure DevOps publication/deployment pipelines separately.

**This is not a zero-cost pause.** Static Web Apps Standard, retained Cosmos/storage data and other billable services remain. Consumption Functions charges are only part of the total; [storage and other services are billed separately](https://learn.microsoft.com/en-us/azure/azure-functions/functions-consumption-costs). Use deletion below to remove the deployment's ongoing resources. Do not assume disabling sign-in or closing the browser stops billing.

To resume:

```sh
az functionapp start --resource-group "$scribe_rg" --name "$scribe_api"
SCRIBE_URL=$(terraform -chdir=infrastructure output -raw web_url) node scripts/smoke.mjs
```

Allow for cold start, sign in and reopen a plan. Resume the intended pipelines. For an identity-only block, an administrator can disable sign-in on the Enterprise application's Properties page; that preserves resources and is not a billing control. Existing access tokens can remain valid until expiry, so stopping the API is the clearer immediate application outage mechanism.

## Delete the deployment

**Destructive: this removes the test data.** The Git repository, a downloaded SSP JSON and Terraform state are not a complete backup of the running application.

### 1. Decide what to retain

For disposable test plans, you can simply accept their loss. Otherwise, export SSPs and pinned baselines from the UI, and arrange a tested Cosmos backup/restore procedure for **both** `ssps` and `content` containers. The `ssps` container includes current documents, access lists, revisions and audit/attestation records; `content` includes historical releases and the active pointer. Exporting only the current OSCAL document does not preserve all of those records. There is currently no bulk SSP restore/import command in this repository.

Retain historical releases referenced by saved plans. If a rebuild must preserve existing plans, validate the data restore process before deletion. Tenant and user object IDs in restored records also matter; they cannot simply be carried into an unrelated company tenant.

### 2. Use the original state to plan destruction

Pause any pipeline that could recreate or update the deployment. Use the same checkout/backend and private tfvars as the deployed environment. Do not initialize an empty state and expect it to find existing resources.

```sh
az login --tenant <CURRENT-TENANT-ID>
az account set --subscription <CURRENT-SUBSCRIPTION-ID>
az account show --query '{subscription:id,tenant:tenantId}' -o table
terraform -chdir=infrastructure state list
terraform -chdir=infrastructure plan -destroy -var-file=test.tfvars -out=destroy.tfplan
terraform -chdir=infrastructure show destroy.tfplan
```

Review the plan: only the intended Scribe resource group, its resources, related role assignments and the Scribe Entra application/service principal should be removed. The OSCAL Lens deployment must not appear. State-storage resources should be outside this deployment and should not appear either.

### 3. Apply the reviewed destruction plan

Only after confirming the backups and resource list:

```sh
terraform -chdir=infrastructure apply destroy.tfplan
```

Applying a saved plan executes it; it does not ask for a second confirmation. The executing identity needs Azure deletion/RBAC permissions **and** Entra permissions to delete the app and assignments. A successful destroy removes the Terraform-managed app registration, Enterprise application, user assignments and API scope configuration as well as the Azure resources.

If destruction fails partway through, preserve state, resolve the named permission/lock/dependency issue, generate a **new** destroy plan and review it. Azure can create auxiliary resources such as a Smart Detection action group. If Terraform refuses to delete a non-empty group, inspect the remaining resources and remove only confirmed Scribe leftovers before replanning; do not disable safeguards across unrelated environments.

### 4. Verify cleanup

Using the captured group name and client ID from the saved outputs:

```sh
az group exists --name <DELETED-SCRIBE-RESOURCE-GROUP>
az ad app show --id <DELETED-SCRIBE-CLIENT-ID>
az ad sp show --id <DELETED-SCRIBE-CLIENT-ID>
terraform -chdir=infrastructure state list
```

Expect `false`, app/service-principal not-found responses, and no managed Scribe resources in state. Also check Cost Management for remaining Scribe resources and delayed charges; deletion does not cancel charges already incurred. Remove any temporary deployment container if one was created outside the Terraform configuration. Keep the state/backend backup until verification is complete.

**Do not use resource-group deletion as the whole teardown procedure.** The [resource-group deletion operation](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/delete-resource-group) removes the Azure resources in that group; Entra app objects are directory resources and need separate cleanup. If you already deleted the group in the portal, use the original state to plan destruction of what remains. If state is lost, recover it from backup/backend versions or inventory and import the remaining objects before managing them; do not apply an empty state against the old deployment.

## Redeploy the application in the existing environment

This rebuilds the site and Function package while retaining the same database and sign-in configuration. It does not republish controlled content or erase SSPs.

1. Use the deployment's existing checkout/state and authenticate to its tenant/subscription.
2. Check out the intended reviewed commit. Retain the ignored tfvars/state/backend files; do not delete `.terraform` or switch backend keys casually.
3. Install and check the code, then deploy:

```sh
npm ci
bash scripts/install-oscal-cli.sh
npm run demo:prepare
OSCAL_CLI="$PWD/work/oscal-cli/bin/oscal-cli" npm run content:build
npm run check
node scripts/deploy-app.mjs
```

The demo preparation in this check sequence produces **local test fixtures only**. It does not publish demo content to Azure. `deploy-app.mjs` rebuilds, uploads a private versioned Function package, configures managed-identity access, regenerates the public `config.json` from Terraform outputs and uploads the frontend. It uses a transient SWA deployment token. The deployment identity needs the permissions described in [the permissions guide](permissions.md#azure-resource-permissions-are-separate).

If Terraform files changed, first review and apply an ordinary infrastructure plan for this environment. Do not run infrastructure apply merely because frontend code changed. To roll application code back, redeploy a prior reviewed compatible commit; this does not roll back database records or the active content release.

### Website-upload troubleshooting

On the original Mac, the native SWA uploader failed with `Failed to contact content server`; the Function package had already deployed. Microsoft's official Linux deployment container successfully uploaded the same web build. A Linux deployment host is the preferred fallback; do not treat the CLI exit code or an Azure holding page as success.

If Docker is available, the already-built website can be uploaded without rebuilding the API. This alternative uses the same official Linux image used for the test deployment (pinned by digest):

```sh
scribe_rg=$(terraform -chdir=infrastructure output -raw resource_group)
scribe_web=$(terraform -chdir=infrastructure output -raw web_name)
export DEPLOYMENT_TOKEN=$(az staticwebapp secrets list --name "$scribe_web" --resource-group "$scribe_rg" --query properties.apiKey -o tsv)
docker run --rm --platform linux/amd64 --entrypoint /bin/bash \
  -e DEPLOYMENT_TOKEN -e DEPLOYMENT_PROVIDER=SwaCli \
  -e SKIP_APP_BUILD=true -e SKIP_API_BUILD=true \
  -e APP_LOCATION=/app -e REPOSITORY_BASE=/ -e CONFIG_FILE_LOCATION=/app \
  -v "$PWD/dist/web:/app" \
  mcr.microsoft.com/appsvc/staticappsclient@sha256:8ed8ea489d04d0636b5c47fbaa44f005975ab0d1f03eddc28014cdf7a061f7f4 \
  -c 'cd /bin/staticsites && ./StaticSitesClient upload'
unset DEPLOYMENT_TOKEN
SCRIBE_URL=$(terraform -chdir=infrastructure output -raw web_url) node scripts/smoke.mjs
```

Use this only after `dist/web/config.json` has been generated for the intended target by the deployment script. Do not enable shell tracing or print the token. The original upload used a temporary Azure Container Instance running this image; that container was removed after completion. Docker on the local Mac is an alternative, not a prerequisite or a service already installed by this project.

## Build from a fresh clone

A fresh deployment creates the application infrastructure and code, **not the contents of a deleted database**. New state normally produces new resource names, URL, Entra client ID and managed identity. Use this procedure after intentionally deleting the old environment, or for an independent environment; use existing state for an existing deployment.

### 1. Tools, source and authentication

Use Node 22+, npm, Java 21+, a current Azure CLI, Terraform >=1.5, Git, curl, zip and unzip. Use a Linux host if the Mac uploader issue above applies. Keep the committed dependency/provider lockfiles.

```sh
git clone https://github.com/mikekuk/OSCAL-scribe.git
cd OSCAL-scribe
# Optionally: git checkout <REVIEWED-COMMIT-OR-TAG>
npm ci
az login --tenant <TARGET-TENANT-ID>
az account set --subscription <TARGET-SUBSCRIPTION-ID>
az account show --query '{subscription:id,tenant:tenantId,name:name}' -o table
az ad signed-in-user show --query '{objectId:id,upn:userPrincipalName}' -o json
```

For a service identity, use its **service principal object ID** instead of `az ad signed-in-user show`. The bootstrap identity must be able to create Azure resources and assign RBAC roles, and to create/manage Entra applications and user app-role assignments. Azure subscription Owner alone does not grant Entra directory administration rights. See [deployment permissions](permissions.md#azure-resource-permissions-are-separate).

The provider intentionally disables automatic Azure resource-provider registration. A subscription administrator must register any missing providers first:

```sh
for scribe_provider in Microsoft.Web Microsoft.Storage Microsoft.DocumentDB Microsoft.Insights Microsoft.OperationalInsights Microsoft.Consumption; do
  az provider register --namespace "$scribe_provider" --wait
done
```

### 2. Create the environment configuration and select state

```sh
cp infrastructure/test.example.tfvars infrastructure/test.tfvars
```

Edit `test.tfvars`: supply the target subscription/tenant, publisher object ID, initial Security users, regions, budget amount **in billing currency**, alert email and budget start date. Use the first day of the current budget month in UTC; the code's default `2026-10-01T00:00:00Z` is specific to the initial test. At least one intended user needs an app-role assignment.

For a personal disposable environment, `terraform init` below uses ignored local state. Protect it. For team/company deployment, first create a dedicated Azure Storage account/container for state, outside the app's disposable group, and grant the deployment identity appropriate blob access. Copy `infrastructure/backend.tf.example` to `infrastructure/backend.tf` and initialize with your private backend settings instead:

```sh
terraform -chdir=infrastructure init \
  -backend-config="resource_group_name=<STATE-RESOURCE-GROUP>" \
  -backend-config="storage_account_name=<STATE-STORAGE-ACCOUNT>" \
  -backend-config="container_name=tfstate" \
  -backend-config="key=<UNIQUE-ENVIRONMENT>/scribe.tfstate" \
  -backend-config="use_azuread_auth=true"
```

Ensure the backend tenant/subscription authentication targets the state account; provide backend `tenant_id`/`subscription_id` when needed. Backend configuration is separate from provider tfvars. Do not copy an existing environment's state into a new one. To move the **same existing deployment** from local to remote state, take a backup and use Terraform's reviewed `init -migrate-state` workflow instead. Do not run that migration when intending to create a second environment.

### 3. Create infrastructure

For local state, initialize now; if the remote backend was initialized above, do not repeat initialization with a different backend:

```sh
terraform -chdir=infrastructure init
terraform -chdir=infrastructure validate
terraform -chdir=infrastructure plan -var-file=test.tfvars -out=deployment.tfplan
terraform -chdir=infrastructure show deployment.tfplan
# After reviewing the target, changes, roles and expected cost:
terraform -chdir=infrastructure apply deployment.tfplan
terraform -chdir=infrastructure output
```

This creates Static Web Apps Standard, a Linux Consumption Function App, managed identity, storage, serverless Cosmos, telemetry, budget, Entra app registration, Enterprise application and configured app-role/data-role assignments. The Standard web plan is required by this architecture's linked Function backend. Do not silently switch to Free while keeping that integration.

### 4. Build/check and publish application code

```sh
bash scripts/install-oscal-cli.sh
npm run demo:prepare
OSCAL_CLI="$PWD/work/oscal-cli/bin/oscal-cli" npm run content:build
npm run check
node scripts/deploy-app.mjs
```

RBAC propagation can take time. Retry a failed operation after verifying the role scope/identity; do not compensate by giving browser users database access. At this point an empty database has no approved profiles until the next step.

### 5. Publish content separately

For a fresh **personal demo** only:

```sh
export COSMOS_ENDPOINT=$(terraform -chdir=infrastructure output -raw cosmos_endpoint)
export COSMOS_DATABASE=scribe
ALLOW_DEMO_PUBLICATION=true npm run content:publish
```

For approved company content, first build from its controlled repository instead of the generated demo directory:

```sh
OSCAL_CLI="$PWD/work/oscal-cli/bin/oscal-cli" npm run content:build -- <PATH-TO-APPROVED-CONTENT-REPOSITORY>
export COSMOS_ENDPOINT=$(terraform -chdir=infrastructure output -raw cosmos_endpoint)
export COSMOS_DATABASE=scribe
unset ALLOW_DEMO_PUBLICATION
npm run content:publish
```

The content directory must contain `manifest.json`, its referenced JSON catalogs/profiles/component definitions and their complete approved import closure. Publication uses the authenticated identity's Cosmos data role. `DefaultAzureCredential` is used: remove stale Azure credential environment variables when intending to use the CLI account. The application identity cannot publish content.

Publishing validates and stores an immutable release before changing the active pointer. Republish an exact archived release artifact to select that release again; regenerating demos from source is not a backup of an older release. Fresh demo publication provides Low/Moderate profiles and the fictional SOC. **The two example SSPs created through the live editor are database records and are not automatically recreated**; create new sample plans after sign-in. See [demo lifecycle](../demo/README.md).

### 6. Verify the deployment

```sh
SCRIBE_URL=$(terraform -chdir=infrastructure output -raw web_url) node scripts/smoke.mjs
API_ONLY=true SCRIBE_URL=$(terraform -chdir=infrastructure output -raw function_url) node scripts/smoke.mjs
```

Then sign in as an assigned user, create a plan, select the SOC if testing demos, edit/save/reopen and validate it. Check revision history and attestation. The smoke checks verify the actual Scribe web build/configuration and anonymous/forged-header denial; they do not prove authenticated access or every permission boundary.

## Deploy into a different Azure environment

**Use a separate clone or working directory and a separate Terraform state/backend key. Changing only the subscription in the existing state is not the migration procedure.** That state still refers to the personal environment's resources and directory objects. A clean deployment is safer than copying the personal database into company Azure.

### Required configuration changes

| Setting | Where to change it | Required action |
| --- | --- | --- |
| Subscription and directory | New environment tfvars: `subscription_id`, `tenant_id`; Azure login | Use the new tenant/subscription and confirm both before plan/apply. |
| Resource naming | `prefix` in tfvars | Choose a distinct prefix, even for a second environment in the same subscription. |
| Regions | `location`, `web_location` in tfvars | Choose supported regions compatible with the linked backend and company policy. Check availability/pricing before plan. |
| People allowed in | `security_user_ids`, `user_ids` in tfvars | Use object IDs from the **target tenant**. Invite external users first if permitted. Personal guest/user object IDs do not transfer. |
| Content/package publisher | `publisher_object_id` in tfvars | Use the target deployment identity's service principal object ID, not its application/client ID. The current template grants this identity both content publication and blob package upload rights. |
| Budget | `monthly_budget`, `budget_email`, `budget_start` in tfvars | Set target billing currency, recipient and current month. This is an alert, not a spending ceiling. |
| State isolation | Backend account/container/key and credentials | Use a unique key; keep state storage outside the app's teardown scope. Do not reuse personal state. |
| Approved OSCAL sources | Separate controlled repository and publication job | Publish company-approved sources. Do not enable demo publication or copy personal SSPs. |
| Browser/API identity settings | Generated from the new Terraform outputs | Deploy again so frontend `config.json`, API settings and redirect URI use the new app/tenant. Never copy the old `dist/web` directory unchanged. |

### Code/template changes required for company production

The current Terraform is a **test-bed template**. These are not all configurable via tfvars yet:

| Current assumption | File | Change before company production |
| --- | --- | --- |
| Resource group `rg-${prefix}-test`, tags `environment=test`, `owner=personal` | `infrastructure/main.tf` | Replace or parameterize group naming and tags to match company/environment ownership. |
| Entra display name ends in `test`; localhost redirect included | `infrastructure/identity.tf` | Set the intended display name; remove `http://localhost:5173/` for production. Retain the exact new HTTPS SPA callback, including trailing slash. |
| Budget name `scribe-test-monthly` | `infrastructure/monitoring.tf` | Rename/parameterize for the environment and set appropriate monitoring/retention limits. |
| Database/container names `scribe`, `ssps`, `content` | `infrastructure/cosmos.tf`, API and publisher configuration | These can stay the same in a separate Cosmos account. If changing them, update role scopes and code/config consistently. |
| One publisher object ID also receives package-upload access | `infrastructure/functions.tf`, `infrastructure/cosmos.tf` | Split publisher/deployer variables and role assignments if using separate company service identities. The existing template does not perform that split automatically. |
| Pipeline backend key `scribe.tfstate`, default environment `scribe-test` | `pipelines/infrastructure.yml`, `pipelines/application.yml` | Parameterize/select distinct state keys and Azure DevOps Environments. Provide the complete environment variables/tfvars to the plan stage. |
| Public linked Function backend, serverless Cosmos, basic telemetry/backup defaults | Infrastructure files | Review against company networking, recovery, retention and operational requirements. Private endpoints require an architecture/integration change; adding them blindly can break the SWA linked API. |

For a second **test** environment, the test suffixes can remain if understood; the new prefix, state and tenant-specific identities still must be separate. Run the fresh-clone procedure after editing these settings. Terraform will create a new app registration and Enterprise application in the target tenant; you do not need to manually recreate the personal app or add a browser client secret.

If adopting an existing company app registration instead, stop and design/import that identity into Terraform first. The current code expects to own its own single-tenant app, delegated scope, app roles, redirect URIs and service principal. Substituting a client ID alone is not sufficient.

### Azure DevOps setup

The YAML files are templates, not configured or previously accepted company pipelines. Set up:

1. An Azure DevOps organization/project, the Scribe Git repository/connection, and a separate approved `ControlledOSCAL` repository with protected branches.
2. Workload-identity-federated Azure Resource Manager service connections for the intended target. Assign Azure and Entra permissions separately. Configure Terraform provider **and backend** authentication for those connections; interactive personal CLI login does not carry into an agent.
3. Private remote state, variables/variable groups and named Environments with approval checks. Supply `stateResourceGroup`, `stateStorageAccount`, subscription/tenant IDs, publisher identity, user-role assignments, regions, prefix and budget. The current infrastructure YAML passes only three `TF_VAR_*` values; extend it or supply an environment tfvars before relying on it.
4. Node 22, Java 21, Terraform and zip/unzip on the agents. Pin tool versions; do not assume everything is installed on `ubuntu-latest`.
5. `azure-pipelines.yml` for checks; `pipelines/infrastructure.yml` for reviewed plan/apply; `pipelines/application.yml` for app deployment; `pipelines/content.yml` for independent content publication. The application template currently rebuilds from its checkout; use the reviewed commit and add artifact promotion if company policy requires deploying an unchanged approved artifact.
6. The correct controlled repository reference and `cosmosEndpoint` for content publication, with no `ALLOW_DEMO_PUBLICATION` in production. Grant the job access to the controlled repository and appropriate Cosmos data role.

Do not authorize a pipeline against personal Azure as a shortcut for company deployment. A pipeline's service connection is a deployment identity; it is not an end-user Scribe app-role assignment.

### Target-tenant acceptance before company use

Repeat these in the **new tenant**, even though the personal test passed:

- Assigned User A can create/edit/reopen; an unassigned user cannot use the API.
- User B cannot read, edit, archive, share, attest or fetch revisions of A's private SSP even knowing its UUID.
- Read sharing permits viewing; edit sharing permits saving but not resharing, archiving or attesting. Revoking a share blocks that user's later requests, including history.
- Security users have global access within the target tenant; users from another tenant are denied.
- Concurrent saves produce a conflict and one new revision; earlier revision hashes remain unchanged.
- Attestation pins the saved revision/hash; a later edit shows Changed since attestation.
- Export validates; approved content publication failures leave the old active release usable, and historical SSPs still reopen after a new content release.
- Verify managed-identity/data roles, backups/restore, alert recipients, billing currency and operational ownership.

See [permissions and access administration](permissions.md) and [security boundaries](security.md) for the exact access model.
