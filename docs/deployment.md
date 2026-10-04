# Deploy OSCAL Scribe entirely through Azure DevOps

The supported deployment path is **GitHub or Azure Repos → Azure DevOps Microsoft-hosted agent → Azure**. You do not install Node, Java, Azure CLI or Terraform on your computer. You do not keep Terraform state, credentials, tfvars or build packages on your computer.

Azure DevOps is a separate service from an Azure subscription. You need an Azure DevOps organization and project, a repository connection, and a federated Azure service connection. A few administrator setup steps cannot be granted by the application to itself; these are listed below.

A first deployment creates an empty application and database. Follow sections 1–5 in order, then optionally publish the demo content in section 6.

## What each pipeline does

| Pipeline to create in Azure DevOps | YAML path | When to run |
| --- | --- | --- |
| Scribe – Backend setup | `pipelines/bootstrap.yml` | Once per environment, before the first deployment; safely rerunnable against its own tagged storage account |
| Scribe – Build and deploy | `azure-pipelines.yml` | Main entry point: builds/tests/deploys main merges; reviews only infrastructure changes |
| Scribe – Demo content | `pipelines/demo.yml` | Optional, after deployment, only for a test environment |
| Scribe – Operations | `pipelines/operations.yml` | Stop, start, or review and destroy the application |
| Scribe – Controlled content | `pipelines/content.yml` | Later, publish approved content from an Azure Repos controlled-content repository |

Use Backend setup to prepare central Terraform storage, then Build and deploy to create the infrastructure and publish the application.

**Do not run Backend setup or Build and deploy until you intend to create billable resources.** GitHub Actions and PR verification create none. Keep the deployment pipeline disabled until you are ready to enable main-merge deployment.

## 1. Create your personal Azure DevOps project

1. Open [Azure DevOps](https://dev.azure.com/) and create an organization, then a **private** project named `OSCAL-Scribe`.
2. In **Organization settings → Parallel jobs**, check that Microsoft-hosted jobs are available. New organizations may need to request the [free hosted parallelism grant](https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs). Approval is external to this repository. You can alternatively purchase hosted capacity; do not create a laptop/self-hosted agent.
3. In **Pipelines → New pipeline**, choose **GitHub**, authorize Azure Pipelines to read `mikekuk/OSCAL-scribe`, then select **Existing Azure Pipelines YAML file**. Select `/azure-pipelines.yml`. Save it as **Scribe – Build and deploy**. Save without running until the backend and permissions are ready. Once enabled, main-branch merges deploy automatically; PR runs only verify.
4. Create the Backend setup, Demo content and Operations pipelines the same way, choosing their YAML paths from the table. Complete the variable group in section 4 before saving/running the YAML if Azure DevOps reports a missing group. The controlled-content pipeline is optional until you have real content.

5. In **Pipelines → Environments**, create **`scribe-test`**. Open **Approvals and checks → Add check → Exclusive lock**. Both deployment and operations use this same environment with sequential locking, so they cannot run against it at the same time. Open the environment's **Security → Pipeline permissions → + (Add pipeline)** and add **Scribe – Build and deploy** and **Scribe – Operations**. For another environment, use its own name and pass it as `environmentName` in both pipelines.
6. Until you are ready, open the main pipeline's **Settings** and disable processing of new run requests. Re-enable it after setup. Main pushes/accepted PRs then build and deploy automatically; `deploy: false` is available for a manual verification-only run. Azure Repos PR validation is configured as a branch policy on `main`; GitHub PR validation uses the YAML `pr` trigger.

Only grant repository access to the repositories you intend this project to build. Do not put Azure credentials or tokens in GitHub. WIF supplies short-lived credentials; the variable group stores environment settings only.

## 2. Prepare the Azure boundary in the portal

Use your intended subscription and its tenant. Their IDs are shown in Azure portal → Subscriptions and Microsoft Entra ID → Overview.

1. Create two empty resource groups in West US 2: **`rg-oscal-scribe-test`** and **`rg-oscal-scribe-state`**. They are administrator-owned boundaries. Keeping them outside Terraform allows the deployment identity to have permissions on these groups rather than on the whole subscription.
2. In the subscription's **Resource providers**, ensure `Microsoft.Web`, `Microsoft.Storage`, `Microsoft.DocumentDB`, `Microsoft.OperationalInsights`, `Microsoft.Insights` and `Microsoft.Consumption` are registered. A subscription administrator performs registration if required; the pipeline does not auto-register providers.
3. Keep the application group empty for the first deployment. The pipeline refuses to create a new state file if it finds existing resources there.

The backend bootstrap creates storage inside the separate state group. Application destruction leaves both group boundaries and the state backend intact.

### Choose the regions before creating the groups

| Setting | What it controls |
| --- | --- |
| Application resource group's location | Functions/Y1 hosting, Cosmos DB, application storage and monitoring |
| `location` in the Library JSON | Terraform state storage account location |
| `web_location` in the Library JSON | Static Web App location |
| State resource group's location | Metadata location for that group; it does not set the storage account's location |

For a simple West US 2 setup, create both groups there and set both JSON location fields to `westus2`. Confirm that the subscription has Y1 capacity in the chosen application region before deploying. Changing the JSON `location` does not move the Function hosting plan. State storage can be in a different region from the application; that alone does not require rebuilding either group.

## 3. Create the federated Azure service connection

In **Project settings → Service connections → New service connection → Azure Resource Manager**:

1. Choose **App registration (automatic)** and **Workload identity federation**. If automatic registration is unavailable, have your administrator create an app registration and use the manual WIF option with the exact issuer and subject supplied by Azure DevOps.
2. Select the intended subscription and the **application resource group**, `rg-oscal-scribe-test`.
3. Name the connection **`oscal-scribe-azure`**. Do not create a client secret.
4. Save the connection with **Grant access permission to all pipelines** unchecked. Open **Project settings → Service connections → oscal-scribe-azure → ⋯ (More actions) → Security**. Under **Pipeline permissions**, click **+ (Add pipeline)** and add **Scribe – Backend setup**, **Scribe – Build and deploy**, **Scribe – Operations** and **Scribe – Demo content**, confirming each selection if prompted. Add Controlled content when you use it. These pipelines must already be saved in Azure DevOps to appear in the selector; YAML files in GitHub alone are not enough. Adding access does not run a pipeline.
5. Return to the connection and select **Manage App registration**. On **Overview**, note its display name and **Application (client) ID**. Click the application name beside **Managed application in local directory** to open its **Enterprise application**, then copy the **Object ID** from that page. This is the **service-principal object ID**. If the link is absent, open **Microsoft Entra ID → Enterprise applications → All applications** and find the same Application ID.

These details identify the pipeline's deployment identity. Keep them available for the following role assignments. The **Object ID on App registrations** identifies a different object from the **Object ID on Enterprise applications**. The human user IDs needed in section 4 come from **Entra ID → Users**, not either application page.

**Manage service connection roles** opens the application's resource-group IAM page. **Manage App registration** opens the deployment app's Entra settings, including its API permissions. Pipeline authorization, Azure resource roles and Microsoft Graph permissions are three separate setup steps.

[Microsoft's WIF setup guide](https://learn.microsoft.com/en-us/azure/devops/pipelines/release/configure-workload-identity) covers the automatic/manual setup screens. Copy current federation values from Azure DevOps rather than inventing an issuer URL.

### Azure IAM grants

Assign the following roles to the **deployment identity identified in step 3.5**. Use an account allowed to assign roles on these resource groups.

1. In Azure portal, open **Resource groups → rg-oscal-scribe-test → Access control (IAM) → Role assignments**.
2. Check whether the deployment application already has **Contributor**; the service connection wizard may have assigned it.
3. For each missing role in the table, select **Add → Add role assignment**. Find the role (the **Privileged administrator roles** tab contains Contributor and Role Based Access Control Administrator), select it, then **Next**.
4. Under **Members**, choose **User, group, or service principal → Select members**. Search using the deployment application's display name or **Application (client) ID**, select it and confirm.
5. If the administrator role presents a **Conditions** page, this template requires permission to assign the roles used by Terraform within this resource group. Choose **Allow user to assign all roles except privileged administrator roles Owner, UAA, RBAC (Recommended)** at this resource-group scope; this template does not assign those three roles. Company administrators can instead design conditions covering the required runtime, publisher and deployment assignments.
6. Select **Review + assign** and confirm the assignment. Repeat for the other missing role.
7. Open **rg-oscal-scribe-state → Access control (IAM)** and repeat for its two roles.

[Microsoft's role-assignment instructions](https://learn.microsoft.com/en-us/azure/role-based-access-control/role-assignments-portal) describe the portal screens.

| Scope | Role | Why / duration |
| --- | --- | --- |
| Application resource group | Contributor | Create/update/delete Scribe resources; normally granted by the connection wizard |
| Application resource group | Role Based Access Control Administrator | Terraform creates the Function runtime and publisher/deployment role assignments; retain for infrastructure operations |
| State resource group | Contributor | Bootstrap creates/configures state storage; remove after successful bootstrap |
| State resource group | Role Based Access Control Administrator | Bootstrap assigns container-scoped state access; remove after successful bootstrap |

Backend setup automatically grants **Storage Blob Data Contributor** to this identity on the **tfstate storage container**. That permission lets future pipelines read, update and lock the Terraform deployment record. No manual assignment of this container permission is needed. Step 5.2 explains exactly which temporary resource-group roles to remove after bootstrap succeeds.

Use separate, restricted pipelines and identities for infrastructure, code deployment and content publication when introducing company separation of duties. The supplied personal configuration intentionally uses one connection for ease of setup; restrict who can edit/queue its pipelines. Code deployment alone does not require directory write permissions.

### Entra permissions: a separate administrator step

1. In Azure DevOps, open **Project settings → Service connections → oscal-scribe-azure → Manage App registration**.
2. In the Azure page, select **API permissions → Add a permission → Microsoft Graph → Application permissions**. Select **Application permissions** because the pipeline uses its own identity.
3. Search for and tick each permission below, expanding its category if needed. Click **Add permissions**. You can add them one at a time by repeating step 2.

   - `Application.ReadWrite.OwnedBy`: manage the Scribe application/service principal owned by the deployment identity.
   - `Application.Read.All`: read the application/service-principal objects used by the provider and preflight.
   - `AppRoleAssignment.ReadWrite.All`: manage Scribe user-role assignments.

4. Back on **API permissions**, click **Grant admin consent for [tenant name]**, then confirm **Yes**.
5. Verify all three entries show **Type: Application** and a green **Granted for [tenant name]** status. Adding permissions alone does not grant consent.

If the consent button is unavailable or access is denied, a tenant **Privileged Role Administrator** or **Global Administrator** can grant this consent. Azure subscription Owner alone does not provide that Entra permission. See [Microsoft's consent requirements](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent).

The last permission is powerful and directory-wide; it is not restricted by the Azure resource-group scope. The company tenant administrator must review it before deployment. Do not give these permissions to browser users or the Scribe frontend. [Terraform's app-role permission requirements](https://registry.terraform.io/providers/hashicorp/azuread/latest/docs/resources/app_role_assignment) describe this boundary.

The pipeline explicitly includes its service principal and your configured administrators as owners of the Scribe objects. The configured owners are applied consistently on every hosted deployment.

## 4. Enter environment settings privately in Azure DevOps

1. Open `config/test.json` in GitHub and copy its JSON as a template. Do not commit your filled-in copy.
2. In Azure DevOps, open **Pipelines → Library → + Variable group**. Name it **`oscal-scribe-test`**.
3. Add one variable named **`scribeEnvironment`**. Paste the complete JSON into its value, replace the placeholder IDs, empty owner/Security lists, storage name and email with your values, then click the lock to mark it **secret** and Save. This JSON contains environment configuration, not a password; keeping it protected avoids publishing personal/company identifiers.
4. Open the variable group's **Pipeline permissions → + (Add pipeline)**. Add Backend setup, Build and deploy, Operations and Demo content using the names you saved in section 1; add Controlled content when needed. If they are absent, save the pipelines first and return here. Set this group's `variableGroup` name consistently on every pipeline (the default is `oscal-scribe-test`).

All Azure tasks read this protected cloud configuration. `config/test.json` documents the shape and fails validation if used with its blank defaults. No downloaded secure file, private tfvars or local environment variable is needed.

| Fields | Meaning |
| --- | --- |
| `subscription_id`, `tenant_id` | Must match the service connection; checked before deployment |
| `resource_group_name` | Empty, administrator-created application group for the first deployment |
| `state_resource_group`, `state_storage_account`, `state_key` | Separate backend; container is always `tfstate` |
| `location`, `web_location` | Backend location and Static Web Apps location; other app resources follow the application group's location |
| `prefix`, `environment` | Application names and Entra display-name suffix |
| `owner_object_ids` | Target-tenant administrators who own the Scribe registration; pipeline identity is added automatically |
| `security_user_ids`, `user_ids` | Target-tenant user object IDs assigned Security or ordinary User access |
| `publisher_object_id` | Empty means use the pipeline identity; set a separate publisher service-principal object ID for controlled publication |
| `monthly_budget`, `budget_email`, `budget_start` | Budget amount in subscription billing currency, recipient and first day of the budget month |
| `allow_demo` | Must be true to run the demo publication pipeline; use false for company production |

The proposed storage name must be globally available. If bootstrap reports it is taken, select a different name in the protected JSON **before the first deployment**. Once deployed, do not change backend identifiers casually: they identify the authoritative state, not just labels.

The template's `monthly_budget` value is **35 in the subscription's billing currency**. Set an amount appropriate to your subscription and spending target. Budgets alert rather than cap spending. The application budget does not include backend storage or Azure DevOps hosted capacity; review those separately in Cost Management.

Keep real environment values in the protected variable group. Do not commit filled-in configuration, secrets, Terraform state or plan files.

## 5. Run the cloud bootstrap, then deploy

Leave `configFile` pointing at the checked-in template: the pipeline reads your actual settings from the Library variable **scribeEnvironment**. If a variable group is missing, check its name and save it in Library. For an authorization error, add the pipeline under the variable group's or service connection's **Pipeline permissions**. Resolve Backend setup failures before starting Build and deploy.

1. Open **Pipelines → Scribe – Backend setup → Run pipeline**. Choose branch **main**, `serviceConnection: oscal-scribe-azure`, `configFile: config/test.json` and `variableGroup: oscal-scribe-test` (or your chosen group name). Click **Run** and watch **Create protected central Terraform backend**. Wait for a successful green result and the **Backend ready** message. This creates the state storage account, private `tfstate` container, version/deletion recovery settings and pipeline storage access. The application is deployed separately.
2. After success, allow a few minutes for role assignments to propagate. Open **Azure portal → Resource groups → rg-oscal-scribe-state → Access control (IAM) → Role assignments**. Find the **deployment service connection's application**. Remove its **Contributor** and **Role Based Access Control Administrator** assignments on this state resource group: select each matching row, click **Remove**, and confirm. Backend setup has already given that identity **Storage Blob Data Contributor on the tfstate container**; keep that permission so future pipelines can read, update and lock the deployment record. No further action is needed for the container permission.
3. When ready to deploy, re-enable processing of new run requests on **Scribe – Build and deploy**. Select **Run pipeline**, branch **main**, **`deploy: true`**, `serviceConnection: oscal-scribe-azure`, `configFile: config/test.json`, `variableGroup: oscal-scribe-test` and `environmentName: scribe-test`. Use your chosen names if they differ. Click **Run**.
4. Build installs Node 22, selects Java 21, downloads/checks Terraform 1.11.4 and the pinned OSCAL CLI, restores locked dependencies, tests, and publishes a versioned application artifact.
5. Plan initializes the Azure backend, generates every Terraform input from the protected cloud configuration and the federated identity, and publishes a saved plan. Review its log.
6. If the plan changes infrastructure, the run pauses for **Manual validation**. Code-only updates skip this pause and deploy automatically. Approve only the intended resources/environment. The review times out to rejection. Restrict Queue builds/validation permissions and add service-connection approvals/checks for company use; the personal setup permits the requesting operator to approve.
7. Deploy uses a fresh hosted agent to initialize the same backend, apply that saved plan, then deploy the **same application artifact built and tested earlier**. It does not rebuild on the deployment agent. Fresh WIF assertions are obtained through the Azure DevOps job endpoint; no laptop login cache is used.
8. Open the URL printed by the deployment. Complete Microsoft sign-in with a configured Security user. Use the URL and client ID produced by this deployment.

The automatic smoke checks verify reachability and denial of anonymous/forged-header requests. They do not replace the first real user test: create, save, reopen and export an SSP; verify a normal user cannot see another user's unshared plan.

Cloud state is authoritative from the first run. Azure Pipelines plan artifacts can contain sensitive attributes: restrict run/artifact access and retention. The pipeline fails when the expected backend is absent for routine operations. Never work around that by initializing an unrelated empty backend or importing everything ad hoc.

## 6. Add demo data separately

Run **Scribe – Demo content** after deployment. It downloads the pinned official SP800-53 catalog, resolves Low and Moderate profiles with OSCAL CLI, creates the fictional company SOC component and publishes an immutable demo release into Cosmos. The release artifact is retained with the pipeline run.

This is never called by the normal deploy pipeline. The SOC contributes partial/shared implementation to AU-2, AU-6, AU-12, IR-4, IR-5, IR-6 and SI-4. It does not certify control compliance.

To remove demo choices, publish a real approved release through **Scribe – Controlled content**. Existing test plans can still reference their historical demo release. For clean production, deploy a fresh company environment with `allow_demo: false` and publish only approved content. No demo SSP/data migration is implicit.

Controlled content uses a separate Azure Repos repository with the manifest/source structure described in `scripts/build-content.ts`. Set `contentRepository` to `Project/Repository` and use an approved immutable tag via `contentRef`. Authorize access to that repository for the pipeline. If a separate publisher is configured, run this pipeline with its own WIF connection and grant it state-read/init capability plus the Terraform-created content role; do not give it infrastructure/Graph write permissions merely to publish.

## Stop, restart, delete and rebuild from the browser

For a maintenance pause or retirement, first disable new run requests on **Scribe – Build and deploy** and let any active deployment finish. Otherwise a later merge can deploy again. Re-enable it when you want automatic updates to resume.

Run **Scribe – Operations** with the desired action:

- **stop**: stops the Function App. Data stays; the frontend may still load. Other resources continue to incur charges.
- **start**: starts the Function App again.
- **destroy**: produces a destruction plan, pauses for manual approval, then deletes Terraform-managed application resources, data and Scribe Entra objects. Back up/export required data first. This is not reversible from source code alone.

Destroy preserves the two administrator-created resource groups, their boundary permissions, and the central state account. Azure-created auxiliary resources such as a Smart Detection action group may remain in the application group; inspect it after destruction. For complete retirement, delete the application group in the portal after confirming Terraform destruction succeeded. Delete the state group only after checking the remote state is empty and retaining any required protected cloud backup/version history. Deleting the state group first loses the deployment record.

To rebuild after `destroy`, leave/recreate the group boundaries and required permissions, then run **Build and deploy** with `deploy: true`. Run Demo content only if wanted. Source recreates an empty environment; restoring SSPs and historical releases requires a separate tested Cosmos backup/restore procedure.

## Recover a partially failed destroy

Keep **Build and deploy** disabled so a main merge cannot rebuild the environment during cleanup. Leave the central state account and `tfstate` blob intact.

1. Open **Scribe – Operations → Run pipeline** and choose the current `main` branch, `action: destroy`, and the **same variable group, service connection and environment** used by the failed run.
2. Start a **new run from PlanDestroy**. Do not use “Rerun failed jobs” on the old Destroy stage: its saved plan describes the environment before the partial deletion.
3. Review the refreshed plan. It should contain only the remaining intended deletions; approve the new plan. Terraform refresh can reconcile tracked objects that Azure has already removed.
4. Inspect the application resource group and Scribe Enterprise application/app registration after completion. Azure-created Smart Detection action groups are separate from Terraform-managed Application Insights resources; inspect leftovers by resource type.

For `Removing pre-authorized application ... 404`, the AzureAD provider has read the application and then failed while updating its pre-authorization list. The message can mean the application or a referenced object disappeared; the error alone does not establish which. The configuration explicitly keeps the Scribe service principal and API URI until pre-authorization cleanup completes, and destruction runs serially to avoid concurrent directory cleanup requests. This is ordering hardening, not a guarantee against all Microsoft Graph consistency errors.

If a **new** run still fails, retain its log lines for `azuread_application.scribe`, `azuread_service_principal.scribe`, `azuread_application_identifier_uri.api` and `azuread_application_pre_authorized.spa`, plus the plan summary. Check the application object ID from the error in the configured Entra tenant. Do not delete the state blob, remove live resources from state, recreate the app or grant broader permissions as a blind workaround. Diagnose the remaining object/reference before any targeted repair.

## Deploy the same repository at work

1. Copy/import this Git repository into your work Azure Repos project, or connect your work Azure DevOps project to an approved GitHub copy. Preserve all files, including dotfiles and both lockfiles. For a private GitHub import, use the import screen's secure repository authentication; do not put a GitHub token into YAML.
2. Create a **new private variable group**, for example `oscal-scribe-company`, in the work Azure DevOps project. Copy the JSON template from `config/test.json` into its secret `scribeEnvironment` variable. Replace all tenant/subscription IDs, owner/user/publisher IDs, resource-group/backend names, regions, prefix, budget and environment label. Set `allow_demo: false`. Never reuse the personal backend.
3. Have the work Azure/Entra administrators perform the scoped setup in sections 2–3. Create `oscal-scribe-azure` in that project; its identity and federation are new, even if the connection name is the same.
4. Create the pipelines from this repository in the work project. For every run select `variableGroup: oscal-scribe-company`, or change the parameter default in the work copy. Set `environmentName` to the work environment with its own Exclusive lock.
5. Run Backend setup, then Build and deploy with `deploy: true`; approve the plan; publish your real controlled content.
6. Validate sign-in, user isolation, saved SSPs and export. Apply company branch protection, service-connection approvals, artifact retention and backup policies.

No personal state, generated file, subscription permission, login cache or laptop installation is copied. The default design uses Azure public-cloud service endpoints reachable by Microsoft-hosted agents. A company requiring private endpoints needs an approved network-connected cloud agent design; selecting private-only networking without that change will prevent these hosted jobs from reaching storage/Cosmos.

## Troubleshooting

| Failure | Fix |
| --- | --- |
| No hosted parallelism | Request the hosted grant or purchase capacity in Organization settings; this is not an application issue |
| Service connection unauthorized | Explicitly authorize this pipeline and confirm WIF trust matches the connection |
| Wrong subscription/tenant | Correct the connection/configuration; do not bypass preflight |
| Backend missing / state missing with resources present | Run initial bootstrap or restore the correct remote state; do not create duplicate resources |
| Storage 403 | Check container data role and propagation, not storage keys |
| Graph 403 | Administrator reviews the deployment app's consented Graph permissions and ownership |
| Role assignment 403 | Check scoped Role Based Access Control Administrator on the application group |
| Resource provider not registered | Subscription administrator registers the required provider |
| Saved plan is stale | Another run changed state; rerun plan and review. Do not force-apply |
| Static deployment or first smoke check fails | Inspect the cloud job logs; rerun Build and deploy after correcting the cause. Do not use a local fallback deployment |
| Sign-in succeeds but access denied | Check Scribe Enterprise app assignment and the target-tenant user object ID |

Terraform/Node/Java versions and locked providers are explicit. Hosted image patch revisions and external service behavior can still change. End-to-end Azure DevOps acceptance requires the first real hosted run; local/static checks do not prove tenant permissions or cloud deployment success.
