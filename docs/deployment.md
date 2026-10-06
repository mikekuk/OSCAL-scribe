# Deployment, shutdown and rebuild runbook

This repository contains the web/API source, schemas, build tools, tests, Terraform and pipelines needed to deploy
OSCAL Scribe. Azure subscriptions, Entra consent, Azure DevOps connections/agents and approved OSCAL content are
operator inputs, not credentials or company data committed to this public repository.

The security work references baseline commit
`dc08a82d1ba34dcb2ab9ab622f40ee428992c310`. The application is unfinished; record the exact deployed commit from
Azure Pipelines and **repeat the security review after development in work dev is complete**.
See [work-dev.md](work-dev.md) and the evolving [before-production.md](before-production.md) guide.

**Implemented hardening snapshot:** [`b6d212ce9ba8c0cf3ce03f8e7acfc581d3617764`](https://github.com/mikekuk/OSCAL-scribe/commit/b6d212ce9ba8c0cf3ce03f8e7acfc581d3617764).
This documentation follow-up names the exact code/configuration snapshot; later application changes need renewed review.

## Choose a profile

Every supplied pipeline accepts `configFile: config/test.json` or `config/dev.json`.
The templates intentionally contain invalid placeholder IDs and cannot deploy unchanged.
Create a protected variable group with secret variable `scribeEnvironment` containing the **complete JSON** copied
from the selected template, with your actual IDs, names, users, email, budget and regions filled in.
The JSON is configuration, not an application password. Keep real company/personal identifiers out of Git.

| Selected profile | Variable group | WIF connections | Environment / data-job pool |
| --- | --- | --- | --- |
| `config/test.json` | `oscal-scribe-test` | `oscal-scribe-azure` for all roles by default | `scribe-test` / Microsoft-hosted |
| `config/dev.json` | `oscal-scribe-dev` | `oscal-scribe-dev-infrastructure`, `oscal-scribe-dev-deployment`, `oscal-scribe-dev-publisher` | `scribe-dev` / `scribe-dev-agents` |

Names may be overridden with pipeline parameters. Profile selection determines defaults, and the loader refuses a
protected JSON environment that differs from the selected file. It also checks the actual subscription, tenant and,
where configured, service-principal object ID before Azure operations. A dev selection cannot silently use test JSON.

The main pipeline builds/tests on push and PR. **Deployment defaults to false**. Explicitly select `deploy: true`
for a cloud run on `main`. A PR never reaches deployment. `deployApplication: false` applies infrastructure only,
which is useful for the first work-dev network setup. No merge automatically deploys this change to personal Azure.

## One-time setup

1. Create an Azure DevOps project, connect this repository, and create pipelines from:
   - `pipelines/bootstrap.yml` — state backend setup;
   - `azure-pipelines.yml` — build, infrastructure plan/review/apply, application deployment;
   - `pipelines/content.yml` — approved content publication;
   - `pipelines/demo.yml` — optional personal/test demo publication;
   - `pipelines/operations.yml` — stop, start and reviewed destroy.
2. Administrators create the selected application and state resource groups. Keep them separate.
   Application resources inherit the app group's region; `location` controls state storage and `web_location` the SWA region.
3. Create Azure Resource Manager service connections using **workload identity federation**, not client secrets.
   For personal test the existing single connection remains supported. For dev use the three connections above.
4. On the **application resource group**, give the infrastructure service principal **Contributor** plus
   **User Access Administrator**. The latter permits custom role definitions, role assignments and deletion locks;
   Contributor alone cannot manage these. **Role Based Access Control Administrator is not a substitute**: it permits
   role assignments but not `Microsoft.Authorization/roleDefinitions/write`. A company-approved custom role can replace
   User Access Administrator if it includes the necessary role-definition, role-assignment and lock read/write/delete
   actions at this scope. Keep these permissions available for future infrastructure plan/apply/destroy operations;
   they are separate from the temporary state-group bootstrap permissions.
   The infrastructure identity manages Entra applications: grant/consent `Application.ReadWrite.OwnedBy`,
   `Application.Read.All`, and `AppRoleAssignment.ReadWrite.All` after tenant-admin review. It is an explicit
   application owner. These Graph grants are directory-wide and must not be given to ordinary deployment/publishing.
5. On the **state resource group**, temporarily grant the bootstrap identity **Contributor** plus
   **User Access Administrator** (or an approved equivalent including role-assignment and deletion-lock management). Bootstrap creates an Entra-only account/container, versioning, 30-day blob/container
   soft deletion, a CanNotDelete lock and container-scoped Storage Blob Data Contributor for infrastructure.
   Remove the broad state-group roles only after Bootstrap succeeds and the container role is verified; retain that
   container role for Terraform state locking and writes. Do not remove the separate application-group permissions.
6. Fill the selected `scribeEnvironment` JSON. Use service-principal **object IDs**, not application/client IDs.
   `owner_object_ids` is for trusted owners; `security_user_ids` grants broad SSP access; `app_admin_user_ids`
   is optional and separately grants administration. Dev requires three distinct pipeline object IDs and rejects
   deployment/publisher ownership. For test, blank identity fields preserve the single-connection fallback.
7. Authorize only the intended pipelines on variable groups and service connections. Create `scribe-test` or `scribe-dev`
   with an exclusive lock. Add work branch-control and independent approval checks to environments/service connections.
   Work manual validation does not permit self-approval. Resource-owner checks remain necessary because YAML is editable.
8. Run Bootstrap with the correct profile. Preserve the resulting state backend throughout application rebuilds.
   After a partial bootstrap, retain its account/ownership tag and rerun; do not create a second backend to hide errors.

Entra Conditional Access, tenant licensing, company agent infrastructure and governance are prerequisites described
in [work-dev.md](work-dev.md); they are not implicitly created by this Terraform project.

## Subscription and pipeline setup details

Before Bootstrap, a subscription administrator must register `Microsoft.Storage`, `Microsoft.Web`,
`Microsoft.DocumentDB`, `Microsoft.Insights`, `Microsoft.OperationalInsights`, `Microsoft.Consumption`, and
`Microsoft.Network` (required for dev). Use Azure portal → Subscriptions → the intended subscription → Resource providers.
Terraform deliberately disables automatic provider registration because the pipeline has resource-group scope.
Check subscription eligibility for budgets, Standard SWA, serverless Cosmos and the selected Function SKU/region;
check EP1 quota before using dev. Budget alerts do not stop resources or cap charges.

In Azure DevOps → Project settings → Service connections, create an Azure Resource Manager connection using workload
identity federation for the chosen tenant/subscription and application resource group. Name it as shown in the profile table.
For dev, repeat with distinct identities for infrastructure, deployment and publication. Record each service principal's
object ID from Entra Enterprise applications. An automatically created connection can receive Contributor: an administrator
must remove that broad assignment from the deployment/publisher identities after infrastructure has granted their narrow
roles. Do not enable "Grant access permission to all pipelines".

A tenant administrator grants the documented **application** Graph permissions to the infrastructure connection's app
registration and consents to them. The app user's Scribe registration is a different object, created by Terraform. At first
deployment, verify its delegated `access_as_user` consent and the intended users' assignments. See [permissions](permissions.md).

Create the selected Azure DevOps variable group and its secret `scribeEnvironment`, authorize the named pipelines only,
and enable branch control/approvals as company policy requires. Under Pipelines → Environments create the selected
`scribe-test` or `scribe-dev`; add an **Exclusive lock** check. Infrastructure and application deployment share one stage
and environment lock, so another run cannot apply infrastructure between those two jobs. State locking still protects
Terraform writes; a plan can become stale while awaiting approval and must then be regenerated.

For work dev, also protect infrastructure, deployment and publisher service connections with branch control and independent
approval checks, and put an Exclusive lock on the publisher connection so content promotions cannot race. Inspect pipeline
permissions and the identities that can modify those checks. A first run may need an administrator to authorize its access
to each protected resource before it can start. Hosted-agent capacity and a company-approved private agent pool are separate
Azure DevOps prerequisites, not resources created by application Terraform.

## Build and deploy

1. Run the main pipeline on `main`, select the profile and `deploy: true`.
2. Build uses locked npm dependencies, pinned GitHub actions where applicable, checksum-verified Terraform/OSCAL/scanner
   tools, unit/security tests, dependency audit, secret scan, dev-profile IaC scan and Terraform validation. Demo fixture
   generation in the build is for tests only; no content is published during application deployment.
3. Plan uses central state and produces a saved plan. Review the environment, permissions, replacements, networking,
   backup policy and deletion locks. Dev runs require review even with no infrastructure changes.
4. Apply checks saved-plan input values against the current effective configuration. If configuration changed since
   planning, re-plan and review. Do not bypass the check. The infrastructure job emits a deployment-target artifact tied
   to commit, subscription, tenant, resource group and environment.
5. Application deployment verifies the target and application file digests, uploads the API to **separate package storage**,
   and configures run-from-package using managed identity, restarts the host and synchronizes its triggers. Existing hash-named blobs are verified, never silently overwritten.
   The runtime has package read access; host-storage permissions do not extend to package storage.
6. The official `AzureStaticWebApp@0` task deploys the already-built frontend with build/API-build disabled. Its token is
   passed as a masked pipeline variable, not a command-line argument or repository file. The application job needs Docker
   on a Linux agent. The smoke step checks reachability and denial of anonymous/forged-header requests.
7. Publish an approved content release using the separate content pipeline. In test only, Demo content may be run explicitly
   with `allow_demo: true`. Dev rejects demo publication. Do not treat sample/demo content as company approval.
8. Complete real sign-in, create/save/reopen/export, user-isolation and permission tests. Automated local checks do not prove
   effective Azure RBAC, private DNS or managed identity runtime access.

For a new dev subscription, first use `deployApplication: false`. Connect an approved Linux agent to the resulting
network/private DNS and register `scribe-dev-agents`, then rerun with `deployApplication: true`. Details, required tools
and the public-API/private-data distinction are in [work-dev.md](work-dev.md).

## Content publication and empty installations

All resolver/publisher/importer source lives in this repository. Approved OSCAL documents are selected by your organisation.
Use the manifest/source format in `scripts/build-content.ts`. The content pipeline can publish pinned NIST reference content
prepared by this repository or a reviewed external `ControlledOSCAL` repository, as described in [content.md](content.md).
No application rebuild is necessary when publishing a new release.

The publisher discovers the Cosmos endpoint using Reader on the selected application group; it does not read or write
Terraform state. Published releases remain immutable through normal publisher operations and the active pointer moves last.
The API can write staged library data but its Cosmos role cannot modify the published `content` container.

For a new installation, complete **Backend setup → Build and deploy → content publication**, using the same selected
profile and protected configuration. Backend setup manages Terraform state storage; **Build and deploy**, with
`deploy: true`, creates Cosmos. Publication requires exactly one Cosmos account in the selected application group and
stops before any writes if endpoint discovery fails. Personal test can use Demo content; work dev uses approved content.

## Stop and restart through Operations

To stop API processing without deleting data, run the **Operations pipeline** (`pipelines/operations.yml`) with the
intended `configFile` and `action: stop`. To resume, run the same pipeline with `action: start`. Both use the selected
central state to identify the Function App and share the protected deployment environment. They do not delete the app,
Entra registration, Cosmos data or state. The static site can remain reachable while API calls fail.

Stopping Functions is an availability/emergency measure, not instant token revocation or a full cost shutdown. SWA,
Cosmos, storage, monitoring and Premium plan charges can continue. To remove application resources, use the separate
reviewed Operations `action: destroy` procedure below. Never choose destruction merely to pause development.

## Important changes from the reviewed baseline

- New `staging` and create-only runtime `audit` containers replace mixed staging/audit storage inside `content`.
  Existing library assets and admin audit events are **not automatically migrated**. Ordinary SSP/release documents keep
  their existing containers, but this runbook recommends a clean rebuild for a disposable personal/test environment.
- Package storage is a new account. Old package blobs in Function host storage are no longer deployment targets.
- Raw browsing and all permanent admin deletion default off, even for AppAdmin. Explicit test switches may enable them.
- Plans, revisions and attestations now return `{items,cursor}`. Frontend and API must be deployed together.
- The host accepts the admin upload ceiling (20,001,000 bytes); the API still enforces 1,000,000 bytes for ordinary requests.
- Cosmos continuous backup and deletion protection are explicit. State is separately protected outside app Terraform.
- Work dev uses EP1 and private data endpoints; it costs more than test. Budgets only alert, not cap spending.

## Recommended transition: Operations pipeline destroy, then Build and deploy

For your disposable personal/test installation, **run the Operations pipeline (`pipelines/operations.yml`) with
`action: destroy` from the old revision, then run the Build and deploy pipeline (`azure-pipelines.yml`) from this revision**.
Throughout this runbook, "destroy the application" means that reviewed Operations pipeline action, not manual resource-group deletion. A full subscription teardown or deletion of all state is not required. This validates a
fresh app build and avoids pretending mixed-container library data has been migrated.

1. Stop automatic/routine deployment and demo/content publication. Export anything worth keeping and record the old commit,
   subscription, tenant, application group, state location and Entra application ID. An SSP JSON export does **not** preserve
   ACLs, revision history, attestations or all content releases; use a tested database recovery procedure if those matter.
2. Before updating the pipeline to this branch, run the **old** `pipelines/operations.yml` from
   `dc08a82d1ba34dcb2ab9ab622f40ee428992c310` (or your actual deployed old commit), `action: destroy`, using the **existing**
   test variable group/service connection/backend. Save a branch/tag at that commit if the Azure DevOps run picker needs one.
   Review and approve the old saved destroy plan. Using old Terraform avoids introducing new required inputs/resources merely
   to retire the old stack. Do not perform this in your work subscription unless you deliberately intend to retire that stack.
3. Verify Terraform-managed application resources and the old Entra application/service principal are gone. Inspect for
   Azure-created auxiliary monitoring resources. State backend and administrator-created groups remain. Do not delete the
   state blob: the completed Operations `action: destroy` run should leave an authoritative empty state.
4. Update the pipeline/repository to this change. Replace the protected test JSON with the complete new template plus your
   existing target IDs/backend identifiers. Keep `protect_data: true`, `allow_destroy: false` and admin switches off by default.
5. Run Bootstrap if you need the new state deletion lock/recovery settings, temporarily restoring only its documented setup
   permissions. Remove those broad state permissions afterward.
6. Run Build and deploy with `config/test.json`, `deploy: true`. This creates the new app registration, accounts, containers,
   roles and application. Re-consent/recheck access where required; new client IDs and URLs may differ.
7. Publish appropriate content (explicit demo only in test), then complete the acceptance checks. A fresh deployment starts
   empty; no implicit migration/restoration is performed.

If the existing environment contains data you must retain, do not use the disposable procedure. Test backup/restore and an
explicit staged-library/admin-audit migration in an isolated environment first. This change contains no silent migration.

## Operations pipeline destruction after deploying this hardened version

Deletion is disabled by default. For a deliberate **test/dev** rebuild:

1. Back up and review the exact target. Set `allow_destroy: true` and `protect_data: false` together in the protected JSON.
2. Run the main pipeline with `deploy: true`, `deployApplication: false` and review the plan removing the Cosmos lock.
   Keep all other hardening settings unchanged. This is an explicit maintenance exception, not a normal dev configuration.
3. Run the **Operations pipeline** (`pipelines/operations.yml`), `action: destroy`, with the same profile/backend. Its guard checks both switches and rejects prod.
   It creates a fresh destroy plan, requires review, rechecks configuration, then applies it. Do not manually delete state first.
4. After success restore `allow_destroy: false`, `protect_data: true` before rebuilding. Keep the authoritative empty state.
5. In dev, agents or peering links attached to the application VNet must be detached/retired before destroying its subnets.
   Company-owned agents are not removed by application Terraform.

Terraform normally removes locks it manages as part of an Operations `action: destroy` run; the explicit guard and reviewed unlock step are therefore
required. The state-account lock is outside application Terraform and must remain during this process.

## Optional complete bootstrap rehearsal / retirement

Only if you specifically want to prove backend bootstrap as well, **after the Operations pipeline has successfully completed `action: destroy`**:

1. Verify and retain the empty state plus any required historical backups/evidence securely.
2. This is a **separate manual administrator action in the Azure portal**, not the Operations pipeline: remove the separately
   managed state lock, then delete the state account/group and empty app
   group if desired. Remove stale service connections/Entra identities only if retiring them; their recreation is a separate
   administrative bootstrap task. Check auxiliary resources and permissions explicitly.
3. Recreate group boundaries, WIF connections/permissions and protected configuration; choose a globally available state
   account name, then run Bootstrap, Build and deploy, content publication and acceptance again.

This complete retirement is **optional**, not necessary for the application hardening. If the Operations pipeline destruction fails, keep state, inspect
errors and rerun a new plan from the appropriate revision. Never switch to a fresh backend while resources still exist.

## Local verification

With Node 22, Java 21 and the documented tools:

```sh
npm ci
bash scripts/ci/install-terraform.sh
bash scripts/install-oscal-cli.sh
npm run demo:prepare
OSCAL_CLI="$PWD/work/oscal-cli/bin/oscal-cli" npm run content:build
npm run check
npm audit --audit-level=moderate
bash scripts/ci/security-scan.sh
work/tools/terraform -chdir=infrastructure init -backend=false -lockfile=readonly
work/tools/terraform -chdir=infrastructure validate
work/tools/terraform -chdir=infrastructure fmt -check -recursive
work/tools/terraform -chdir=infrastructure test -var-file=../work/security-dev.tfvars.json
node scripts/ci/package.mjs
```

The secret scanner covers repository source. The IaC scanner evaluates the hardened dev profile with synthetic IDs;
its pinned embedded checks are deterministic. Test intentionally permits authenticated public data endpoints because Y1
cannot use the private-data topology. This exception is not carried into dev. Review scanner/tool updates regularly.
Never put actual state, plans, populated JSON, deployment tokens or cloud credentials in Git or build logs.

Deployment implementation references: [external package deployment and trigger synchronization](https://learn.microsoft.com/azure/azure-functions/functions-deployment-technologies#external-package-url), [official SWA pipeline task](https://learn.microsoft.com/azure/devops/pipelines/tasks/reference/azure-static-web-app-v0).
