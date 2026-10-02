# Personal Azure test-bed deployment

Personal test bed: choose the authorized subscription in your ignored tfvars file; US West preferred, USD 50/month target. Default region is West US 2. Static Web Apps Standard is required for linking an independently managed Function App. Functions uses Consumption with scale limit 2; Cosmos is single-region serverless; telemetry is sampled and capped at 0.1 GB/day. A resource-group budget tracks 50/month and sends 50/80/100% notifications when `budget_email` is supplied. Budgets alert; they do not impose a hard spending cap. Verify the subscription billing currency and current Azure retail rates before applying. Heavy traffic can exceed the target.

## Prerequisites and first deployment

1. Install Node 22+, Java 21+, Azure CLI, Terraform >=1.5, zip/unzip. Sign in with `az login`; select the requested subscription with `az account set --subscription <id>`.
2. Identify the tenant and signed-in object's immutable ID using `az account show` and `az ad signed-in-user show`. The deployer needs resource creation/RBAC permissions and Entra application/consent permissions. Never put credentials in tfvars.
3. Copy `infrastructure/test.example.tfvars` to an ignored `.tfvars` file and supply tenant/object IDs, your budget email and initial role assignments. Security users have global SSP access; User users have owner/shared access. Configure a private Azure Storage Terraform backend before team/company deployment. Local test state is ignored by Git and must still be protected and backed up.
4. `terraform -chdir=infrastructure init`; `terraform -chdir=infrastructure plan -var-file=test.tfvars -out=test.tfplan`. Review the exact subscription, resources, role assignments and estimate. Apply only the reviewed plan: `terraform -chdir=infrastructure apply test.tfplan`.
5. `node scripts/deploy-app.mjs`. It builds, installs locked runtime dependencies, uploads a versioned package to private blob storage, configures managed-identity package access, and deploys the static assets. Only public tenant/client identifiers enter config.json. The SWA deployment token is transient, never source-controlled. Azure RBAC propagation can take several minutes; retry only the failed deployment step once permissions have propagated.
6. Publish controlled content separately. For the demo, follow `demo/README.md`; set `COSMOS_ENDPOINT` to the Terraform output, `AZURE_TENANT_ID` if needed, and `ALLOW_DEMO_PUBLICATION=true`. The authenticated publisher identity must have the content-container data role. The application identity has read-only access to that container.
7. Open the web URL and sign in. If tenant policy requires admin consent, grant the app's own delegated `access_as_user` scope in Entra using an administrator. This is a documented tenant-policy step, not a local-password workaround. Enterprise application assignment is required.

## Acceptance checks

Run `SCRIBE_URL=<web_url> node scripts/smoke.mjs`. Repeat with the direct Function URL to prove browser-controlled identity headers are not trusted (platform denial or API 401/403 is acceptable). Then perform real-tenant acceptance:

- User A creates Low and Moderate SSPs; roles, SOC and control/statement/ODP edits save and reopen.
- User B cannot read, edit, archive, share, attest or fetch revisions of A's private SSP, even knowing its UUID.
- Read sharing permits viewing only; edit sharing permits saving but cannot reshare/attest/archive.
- Revocation blocks old revisions immediately; Security role can access both users' plans.
- Concurrent saves produce a conflict and exactly one new revision; original revision digest is unchanged.
- Attestation pins revision/hash; subsequent edits show Changed since attestation.
- Raw export passes schema checks. Review private content-container RBAC and absence of Cosmos keys in browser traffic.
- Publish an invalid profile to a test staging directory: build must fail, active release must stay unchanged. Reopen historical SSPs after publishing a new release.

Do not label the company deployment accepted until these checks pass in its tenant.

## Azure DevOps setup and company migration

Azure DevOps is not provisioned by this application. Create an organization/project when ready, then a `ControlledOSCAL` Git repository whose root contains manifest.json plus its referenced JSON files. Use Entra/workload-identity-federated Azure service connections: one narrowly scoped for app deployment, one for infrastructure, one with content-container data writer permissions for publication. Protect the approved content branch and production Environment with reviews/approval checks.

Import `azure-pipelines.yml` for app checks/artifact creation, `pipelines/content.yml` for content validation/resolution/publication, and `pipelines/infrastructure.yml` for reviewed infrastructure plans. Pipeline variables supply tenant, subscription, endpoint and publisher object IDs. Hosted agents need Java 21 and Terraform; pin tool versions. Set the Terraform remote backend and variable group before running infrastructure plans. Execute app deployment from its reviewed build using the deployment script/service connection. No pipeline automatically applies infrastructure on frontend edits.

For company Azure, use separate tfvars, resource group, app registration, Cosmos account and state key. Remove localhost redirect URI, replace demo sources with the approved Azure DevOps repository, use a dedicated publisher identity, configure company assignments and budget, and repeat the acceptance checks. Existing demo releases must not be repurposed as company authoritative content.

## Retirement and rollback

App rollback: redeploy a prior reviewed commit/package. Content rollback: move the active pointer to a previously validated immutable release using a reviewed publisher operation; historical releases are never overwritten. Archive SSPs rather than delete them. Terraform destroy is destructive: export any needed test plans and explicitly review a destroy plan before removing the test resource group. Do not delete historical content still referenced by retained SSP revisions.
