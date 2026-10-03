# Deploy OSCAL Scribe entirely through Azure DevOps

The supported deployment path is **GitHub or Azure Repos → Azure DevOps Microsoft-hosted agent → Azure**. You do not install Node, Java, Azure CLI or Terraform on your computer. You do not keep Terraform state, credentials, tfvars or build packages on your computer.

Azure DevOps is a separate service from an Azure subscription. You need an Azure DevOps organization and project, a repository connection, and a federated Azure service connection. A few administrator setup steps cannot be granted by the application to itself; these are listed below.

The previous personal deployment was destroyed on 3 October 2026. Do not copy or migrate its local state into this new setup. The first pipeline deployment creates a fresh application and database. Saved data from the retired test bed is not restored.

## What each pipeline does

| Pipeline to create in Azure DevOps | YAML path | When to run |
| --- | --- | --- |
| Scribe – Backend setup | `pipelines/bootstrap.yml` | Once per environment, before the first deployment; safely rerunnable against its own tagged storage account |
| Scribe – Build and deploy | `azure-pipelines.yml` | Main entry point: builds/tests/deploys main merges; reviews only infrastructure changes |
| Scribe – Demo content | `pipelines/demo.yml` | Optional, after deployment, only for a test environment |
| Scribe – Operations | `pipelines/operations.yml` | Stop, start, or review and destroy the application |
| Scribe – Controlled content | `pipelines/content.yml` | Later, publish approved content from an Azure Repos controlled-content repository |

The former infrastructure and application YAML entry points are consolidated into the main pipeline. There is no need to run separate infrastructure and application pipelines for a first deployment.

**Do not run Backend setup or Build and deploy until you intend to create billable resources.** GitHub Actions and PR verification create none. Keep the deployment pipeline disabled until you are ready to enable main-merge deployment.

## 1. Create your personal Azure DevOps project

1. Open [Azure DevOps](https://dev.azure.com/) and create an organization, then a **private** project named `OSCAL-Scribe`.
2. In **Organization settings → Parallel jobs**, check that Microsoft-hosted jobs are available. New organizations may need to request the [free hosted parallelism grant](https://learn.microsoft.com/en-us/azure/devops/pipelines/licensing/concurrent-jobs). Approval is external to this repository. You can alternatively purchase hosted capacity; do not create a laptop/self-hosted agent.
3. In **Pipelines → New pipeline**, choose **GitHub**, authorize Azure Pipelines to read `mikekuk/OSCAL-scribe`, then select **Existing Azure Pipelines YAML file**. Select `/azure-pipelines.yml`. Save it as **Scribe – Build and deploy**. Save without running until the backend and permissions are ready. Once enabled, main-branch merges deploy automatically; PR runs only verify.
4. Create the Backend setup, Demo content and Operations pipelines the same way, choosing their YAML paths from the table. Complete the variable group in section 4 before saving/running the YAML if Azure DevOps reports a missing group. The controlled-content pipeline is optional until you have real content.

5. In **Pipelines → Environments**, create **`scribe-test`**. Open **Approvals and checks → Add check → Exclusive lock**. Both deployment and operations use this same environment with sequential locking, so they cannot run against it at the same time. Authorize only the Scribe pipelines. For another environment, use its own name and pass it as `environmentName` in both pipelines.
6. Until you are ready, open the main pipeline's **Settings** and disable processing of new run requests. Re-enable it after setup. Main pushes/accepted PRs then build and deploy automatically; `deploy: false` is available for a manual verification-only run. Azure Repos PR validation is configured as a branch policy on `main`; GitHub PR validation uses the YAML `pr` trigger.

Only grant repository access to the repositories you intend this project to build. Do not put Azure credentials or tokens in GitHub. WIF supplies short-lived credentials; the variable group stores environment settings only.

## 2. Prepare the Azure boundary in the portal

Use your intended subscription and its tenant. Their IDs are shown in Azure portal → Subscriptions and Microsoft Entra ID → Overview.

1. Create two empty resource groups in West US 2: **`rg-oscal-scribe-test`** and **`rg-oscal-scribe-state`**. They are administrator-owned boundaries. Keeping them outside Terraform allows the deployment identity to have permissions on these groups rather than on the whole subscription.
2. In the subscription's **Resource providers**, ensure `Microsoft.Web`, `Microsoft.Storage`, `Microsoft.DocumentDB`, `Microsoft.OperationalInsights`, `Microsoft.Insights` and `Microsoft.Consumption` are registered. A subscription administrator performs registration if required; the pipeline does not auto-register providers.
3. Keep the application group empty for the first deployment. The pipeline refuses to create a new state file if it finds existing resources there.

The backend bootstrap creates storage inside the separate state group. Application destruction leaves both group boundaries and the state backend intact.

## 3. Create the federated Azure service connection

In **Project settings → Service connections → New service connection → Azure Resource Manager**:

1. Choose **App registration (automatic)** and **Workload identity federation**. If automatic registration is unavailable, have your administrator create an app registration and use the manual WIF option with the exact issuer and subject supplied by Azure DevOps.
2. Select the intended subscription and the **application resource group**, `rg-oscal-scribe-test`.
3. Name the connection **`oscal-scribe-azure`**. Do not create a client secret.
4. Authorize only these Scribe pipelines to use the connection. Do not grant access to all pipelines.
5. Use **Manage service principal** to find the connection's Entra application and service-principal object ID. This is the deployment identity, not Scribe's end-user application.

[Microsoft's WIF setup guide](https://learn.microsoft.com/en-us/azure/devops/pipelines/release/configure-workload-identity) covers the automatic/manual setup screens. Copy current federation values from Azure DevOps rather than inventing an issuer URL.

### Azure IAM grants

An administrator assigns the service principal these roles:

| Scope | Role | Why / duration |
| --- | --- | --- |
| Application resource group | Contributor | Create/update/delete Scribe resources; normally granted by the connection wizard |
| Application resource group | Role Based Access Control Administrator | Terraform creates the Function runtime and publisher/deployment role assignments; retain for infrastructure operations |
| State resource group | Contributor | Bootstrap creates/configures state storage; remove after successful bootstrap |
| State resource group | Role Based Access Control Administrator | Bootstrap assigns container-scoped state access; remove after successful bootstrap |

Bootstrap grants **Storage Blob Data Contributor on the `tfstate` container** to the connection's identity. This remains for state access and locking. No subscription Owner role, storage account key or persistent password is required.

Use separate, restricted pipelines and identities for infrastructure, code deployment and content publication when introducing company separation of duties. The supplied personal configuration intentionally uses one connection for ease of setup; restrict who can edit/queue its pipelines. Code deployment alone does not require directory write permissions.

### Entra permissions: a separate administrator step

On the **deployment service connection's app registration**, add these **Microsoft Graph application permissions** and grant tenant administrator consent:

- `Application.ReadWrite.OwnedBy`: manage the Scribe application/service principal owned by the deployment identity.
- `Application.Read.All`: read the application/service-principal objects used by the provider and preflight.
- `AppRoleAssignment.ReadWrite.All`: manage Scribe user-role assignments.

The last permission is powerful and directory-wide; it is not restricted by the Azure resource-group scope. The company tenant administrator must review it before deployment. Do not give these permissions to browser users or the Scribe frontend. [Terraform's app-role permission requirements](https://registry.terraform.io/providers/hashicorp/azuread/latest/docs/resources/app_role_assignment) describe this boundary.

The pipeline explicitly includes its service principal and your configured administrators as owners of the Scribe objects. Ownership does not depend on whichever person happens to run Terraform locally.

## 4. Enter environment settings privately in Azure DevOps

1. Open `config/test.json` in GitHub and copy its JSON as a template. Do not commit your filled-in copy.
2. In Azure DevOps, open **Pipelines → Library → + Variable group**. Name it **`oscal-scribe-test`**.
3. Add one variable named **`scribeEnvironment`**. Paste the complete JSON into its value, replace the placeholder IDs, empty owner/Security lists, storage name and email with your values, then click the lock to mark it **secret** and Save. This JSON contains environment configuration, not a password; keeping it protected avoids publishing personal/company identifiers.
4. Under **Pipeline permissions**, authorize only your Scribe pipelines. If you have not created them yet, return here after doing so. Set this group's `variableGroup` name consistently on every pipeline (the default is `oscal-scribe-test`).

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

The personal budget is **£35**, preserving the previous margin beneath the requested US$50 target. Exchange rates/taxes may change that relationship. Budgets alert rather than cap spending. The application budget does not include backend storage or Azure DevOps hosted capacity; review those separately in Cost Management.

Keep real environment values in the protected variable group. Do not commit filled-in configuration, secrets, Terraform state or plan files.

## 5. Run the cloud bootstrap, then deploy

1. Run **Scribe – Backend setup** with defaults. It creates a Standard LRS storage account, disables shared-key and anonymous blob access, enables versioning and 30-day blob/container deletion recovery, creates `tfstate`, and assigns state access. It does **not** deploy the application or use local Terraform state.
2. Wait a few minutes for new role assignments to propagate. Remove the two temporary state-group management roles from the connection; retain its container data role.
3. Run **Scribe – Build and deploy**, set **`deploy` to true**, and leave `serviceConnection` as `oscal-scribe-azure` and `configFile` as `config/test.json`.
4. Build installs Node 22, selects Java 21, downloads/checks Terraform 1.11.4 and the pinned OSCAL CLI, restores locked dependencies, tests, and publishes a versioned application artifact.
5. Plan initializes the Azure backend, generates every Terraform input from the protected cloud configuration and the federated identity, and publishes a saved plan. Review its log.
6. If the plan changes infrastructure, the run pauses for **Manual validation**. Code-only updates skip this pause and deploy automatically. Approve only the intended resources/environment. The review times out to rejection. Restrict Queue builds/validation permissions and add service-connection approvals/checks for company use; the personal setup permits the requesting operator to approve.
7. Deploy uses a fresh hosted agent to initialize the same backend, apply that saved plan, then deploy the **same application artifact built and tested earlier**. It does not rebuild on the deployment agent. Fresh WIF assertions are obtained through the Azure DevOps job endpoint; no laptop login cache is used.
8. Open the URL printed by the deployment. Complete Microsoft sign-in with a configured Security user. The new deployment has new resource names/client IDs; the old URL is retired.

The automatic smoke checks verify reachability and denial of anonymous/forged-header requests. They do not replace the first real user test: create, save, reopen and export an SSP; verify a normal user cannot see another user's unshared plan.

Cloud state is authoritative from the first run. Azure Pipelines plan artifacts can contain sensitive attributes: restrict run/artifact access and retention. The pipeline fails when the expected backend is absent for routine operations. Never work around that by initializing an unrelated empty backend or importing everything ad hoc.

## 6. Add demo data separately

Run **Scribe – Demo content** after deployment. It downloads the pinned official SP800-53 catalog, resolves Low and Moderate (the requested “medium”) profiles with OSCAL CLI, creates the fictional company SOC component and publishes an immutable demo release into Cosmos. The release artifact is retained with the pipeline run.

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
