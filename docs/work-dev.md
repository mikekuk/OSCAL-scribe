# Work development deployment and security validation

**Status: development guidance, not a production security approval.**

This work was based on OSCAL-scribe commit
[`dc08a82d1ba34dcb2ab9ab622f40ee428992c310`](https://github.com/mikekuk/OSCAL-scribe/tree/dc08a82d1ba34dcb2ab9ab622f40ee428992c310).
The application is unfinished and its architecture, permissions and deployment requirements may change.
The changes in this branch address that baseline; they are not a claim that the baseline already had these controls.
Record the exact deployed `Build.SourceVersion` from each pipeline run in the work-dev acceptance record.
**Repeat the security review after development in the work environment is complete, against that final commit and the actual Azure deployment.**

Use [deployment.md](deployment.md) for the executable deployment/rebuild sequence and
[before-production.md](before-production.md) for the subsequent release guide.
No Azure deployment is performed by adding `config/dev.json` to Git.

**Implemented hardening snapshot:** [`b6d212ce9ba8c0cf3ce03f8e7acfc581d3617764`](https://github.com/mikekuk/OSCAL-scribe/commit/b6d212ce9ba8c0cf3ce03f8e7acfc581d3617764).
This documentation follow-up names the exact code/configuration snapshot; later application changes need renewed review.

## What dev.json deploys

Select `configFile: config/dev.json` in the supplied pipelines. It selects work defaults:

| Item | Default |
| --- | --- |
| Variable group | `oscal-scribe-dev` |
| Infrastructure WIF connection | `oscal-scribe-dev-infrastructure` |
| Application WIF connection | `oscal-scribe-dev-deployment` |
| Content WIF connection | `oscal-scribe-dev-publisher` |
| Deployment environment | `scribe-dev` |
| Application/content agent pool | `scribe-dev-agents` |
| Function hosting | Linux Elastic Premium `EP1`, Node 22 |
| Frontend | Static Web Apps Standard and linked Function API |
| Private data | Cosmos, Function host storage and deployment package storage |
| Networking | New VNet, integration subnet, private endpoint subnet, agent subnet, private DNS links |
| Database containers | `ssps`, read-only-to-runtime `content`, writable `staging`, create-only-to-runtime `audit` |
| Recovery | Seven-day continuous Cosmos backup, Cosmos deletion lock; state versioning/soft deletion/lock |
| Administrative features | Raw browsing and permanent deletion disabled |
| Demo / localhost redirects | Both disabled |
| Logs | 90 days, 1 GB/day configured ingestion cap |
| Instance-local abuse limits | 120 total and 10 expensive requests per authenticated tenant/user per minute |

These resources incur costs. The example budget is an alert in the subscription billing currency,
not a quotation or a spending cap. Check company region availability, quota, budget and naming rules.
`location` is the **state** account location; application resources inherit the pre-created application
resource group's location. `web_location` selects the supported SWA region. Choose a non-overlapping
`vnet_cidr` with your network team; the default is `10.42.0.0/16` and the first three /24s are reserved.

The API remains publicly reachable for SWA linking and verifies every bearer token itself. Data services
have public network access disabled. This is **private data networking, not a fully private application**.
SWA linked APIs do not support network-isolated backends. If company policy requires private API ingress,
redesign the gateway/frontend integration in work dev before production; do not simply turn off the API endpoint.

The Terraform state account remains a separate Entra-only public endpoint so bootstrap and infrastructure
planning can use hosted agents. Its container is not anonymously public. If company policy also requires private
state, extend the bootstrap/state networking and move infrastructure jobs onto an approved network-connected
pool **before** disabling state public reachability. The supplied dev profile does not claim private state.

## Prerequisites owned by the work environment

1. Have administrators create separate application and state resource groups in the approved work subscription.
2. Create the three workload-identity-federated service connections and record their **service principal object IDs**
   (not client/application IDs) in a protected copy of `config/dev.json`. Use work identities only.
3. Give only the infrastructure connection **Contributor** plus **User Access Administrator** on the application
   resource group, or a company-approved equivalent with role-definition, role-assignment and lock read/write/delete
   permissions. Role Based Access Control Administrator alone cannot create the custom deployment role.
   Keep these app-group permissions available for infrastructure maintenance. This identity also manages Entra
   application ownership and assignments;
   its Graph application permissions are `Application.ReadWrite.OwnedBy`, `Application.Read.All` and
   `AppRoleAssignment.ReadWrite.All`, with tenant administrator consent. The last grant is directory-wide:
   a resource-group boundary does not constrain it. Restrict this identity and its pipeline especially tightly.
4. Bootstrap temporarily needs **Contributor** plus **User Access Administrator** (or an approved equivalent) on the
   state group, including permission to create its deletion lock. Remove those broad state-group grants only after
   successful bootstrap and verification of the container-scoped state role;
   retain the generated container-scoped state data access. Terraform requires Azure RBAC role-definition administration
   in the app group for the custom deployment role. Cosmos SQL audit roles use separate DocumentDB management actions.
5. The **deployment** identity receives only the custom code-deployment role and package-container blob access
   from Terraform. Do not grant it application ownership, Graph writes, infrastructure Contributor or state access.
   The **publisher** receives Cosmos content-container write access plus app-group Reader for endpoint discovery;
   it also needs no Graph writes or state access. Existing broad manual grants must be removed separately.
6. Configure `scribe-dev` approvals, an exclusive lock, branch control and service-connection/variable-group
   pipeline permissions in Azure DevOps. Allow only the intended pipeline IDs. Work-dev manual validation forbids
   self-approval. Pipeline YAML cannot prevent a resource administrator from bypassing its checks; review that access.
7. Have the identity team apply the company Conditional Access/guest policy. Terraform keeps the registration
   single tenant, requires assignment and removes localhost redirects in dev. Conditional Access, device compliance
   and temporary elevation depend on company licensing and tenant administration; they are not created by this module.

## First deployment and the agent network

Run the main pipeline with `deploy: true`, `deployApplication: false`, `configFile: config/dev.json` first.
The build, plan and infrastructure apply run on hosted Linux agents using ARM and the public Entra-only state backend.
The pinned AzureRM provider sets `features.storage.data_plane_available = false`, so storage account creation and
blob-property management do not probe private data endpoints. The package container also uses its ARM resource ID.
This creates the VNet and private endpoints before a network-connected deployment agent is needed. New storage
resources that require data-plane access must be reviewed before adding them to this hosted infrastructure job.

Then attach an **approved Linux Azure Pipelines agent** to `scribe-dev-agents`. Use the created agent subnet or
an approved peered network. Provision agent compute through the company's agent platform; this repository creates
the subnet, not a VM, agent registration token or company agent platform. The agent must have:

- Azure CLI, Node 22 support, curl, unzip, tar, zip, Java 21 (`JAVA_HOME_21_X64` for JavaToolInstaller), and Docker
  usable by the agent account for `AzureStaticWebApp@0`;
- outbound access to Azure DevOps, Entra, ARM, the SWA deployment endpoints, npm, GitHub and Maven for pinned tools;
- DNS resolution and HTTPS access to the private blob/queue/table and Cosmos endpoints;
- no inbound public management ports and no persisted pipeline credentials between jobs.

For peering, arrange forward/reverse connectivity and link/forward the new private DNS zones to the agent network.
A VNet link to the Function network alone does not provide DNS resolution from another network.
Do not run builds from untrusted pull requests on this privileged pool. Build validation remains on hosted agents.

Verify package-storage and Cosmos FQDNs resolve to private IPs from the agent. Rerun the main pipeline with
`deployApplication: true` once it is ready. An unchanged Terraform plan still deploys the built artifact.
Content publication also uses this pool in dev. No personal Azure agent or login is involved.

## Work-dev acceptance record

Record the deployed commit, config profile (with identifying values redacted), Terraform provider lockfile,
artifact digests, pipeline run IDs, actual Azure resource IDs, tester and date. Preserve evidence of:

- real Entra sign-in; ordinary users unable to read another user's current or historical SSP;
- role assignment/removal and the observed token-revocation delay; no assumption of instant role revocation;
- `allow_raw_browser=false` and `allow_permanent_delete=false` rejecting direct API calls, not just hiding buttons;
- successful staging upload/export and publication, with runtime writes to **published content** denied by Cosmos;
- runtime package read succeeding but overwrite/delete denied; publisher unable to deploy application code;
- audit create succeeding and audit replace/delete/read denied to the runtime identity;
- ordinary and admin upload boundaries, paginated results, malformed JSON, invalid cursors and rate-limit responses;
- private data endpoint isolation, hosted/external agent failures, and the linked API's direct access/auth boundary;
- effective browser headers, reauthentication, logout, history-page restoration, and large SSP workflows;
- two concurrent edits producing a conflict rather than losing history;
- backup restoration into a disposable environment including SSP history, staged assets and historical published releases;
- initial install, upgrade, rollback, failed publication, failed deployment and reviewed teardown/rebuild.

The built-in limiter is per process, resets on recycle and is not a distributed quota. Before production, prove an
appropriate shared or gateway control across instances. Audit create-only RBAC protects old audit items against
runtime mutation, but a compromised runtime can still append false events; external retention and correlation are
separate work. SSP revisions remain in a writable SSP container and are not storage-enforced WORM records.

## Remaining work during work development

Evaluate splitting the destructive/admin API into a separate application/identity, replacing standing AppAdmin
assignments with controlled elevation, and moving audit evidence into independently retained storage/SIEM.
Define alert thresholds and responders, recovery objectives, guest access, data classification and retention.
Choose the ingress/WAF design based on actual exposure; do not buy or deploy an untested production gateway at cutover.
Revisit the broad Graph `User.Read.All` directory lookup requirement and infrastructure Graph grants with the tenant team.

Security sources: [Functions networking](https://learn.microsoft.com/azure/azure-functions/functions-networking-options),
[SWA API constraints](https://learn.microsoft.com/azure/static-web-apps/apis-overview),
[Azure DevOps resource checks](https://learn.microsoft.com/azure/devops/pipelines/process/approvals),
[Entra licensing](https://learn.microsoft.com/entra/fundamentals/licensing).
