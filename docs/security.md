# Security architecture, controls and operating requirements

**Implemented hardening snapshot:** [`b6d212ce9ba8c0cf3ce03f8e7acfc581d3617764`](https://github.com/mikekuk/OSCAL-scribe/commit/b6d212ce9ba8c0cf3ce03f8e7acfc581d3617764).
This documentation follow-up names the exact code/configuration snapshot; later application changes need renewed review.

## Status, scope and review baseline

This is the central security reference for OSCAL Scribe's browser application, Function API, Azure resources,
content publication and deployment pipelines. It describes implemented controls and their limits; it is not a
production approval or a claim that the unfinished application is secure against every threat.

The source review and hardening work started from commit
[`dc08a82d1ba34dcb2ab9ab622f40ee428992c310`](https://github.com/mikekuk/OSCAL-scribe/tree/dc08a82d1ba34dcb2ab9ab622f40ee428992c310).
The controls described as added here are changes **after** that baseline, not properties of that old commit.
The app, its threat model and its deployment design may change during development. For each deployment, record
its exact `Build.SourceVersion`, artifact digests, configuration profile and pipeline run IDs. Use the corresponding
revision of this document when reviewing that deployment.

**Repeat the security review after development and integration in the work subscription are complete.** Review the
exact final commit and the actual deployed Azure configuration, then update this document and the release evidence.
Local checks cannot establish effective cloud permissions, tenant policies, network isolation or successful recovery.

Related maintained documents:

- [Deployment, Operations pipeline destruction and rebuild](deployment.md): executable operator runbook.
- [Work-dev preparation and acceptance](work-dev.md): work identities, private agents, networking and live checks.
- [Before-production guide](before-production.md): evolving release decisions and evidence requirements.
- [Identity and permissions](permissions.md), [directory sharing](directory-sharing.md) and [API contract](api.md).
- [App Admin](app-admin.md), [controlled publication](content.md) and [SSP upload](ssp-upload.md).

## Security objectives and protected information

Protect SSP bodies, historical revisions, attestations, sharing ACLs, actor identities, staged company OSCAL files,
approved releases and audit evidence against unauthorized disclosure or modification. Protect executable packages,
Terraform state, pipeline credentials and deployment configuration against changes that could bypass those controls.
Preserve enough validated history and recovery capability to explain changes and restore service.

A system-security plan can expose architecture, weaknesses, supplier details and personal contact information.
The work owner must classify that information, choose approved regions/retention and define permitted users before
uploading company data. Browser exports and publication bundles are copies outside the application's revocation
boundary. Removing application access cannot recall a downloaded file.

Schema validity, baseline selection and recorded attestation do not establish compliance or control effectiveness.
Attestation records an authorized user's declaration about an exact saved revision; it is not a personal digital
signature or proof that the declarant holds the corresponding organizational role.

## Trust boundaries and deployment profiles

The browser authenticates through single-tenant Entra, sends a delegated bearer token to the Function API, and
receives only API-authorized data. The API uses its managed identity for Cosmos and Microsoft Graph. A separate
publisher promotes approved content; infrastructure and application deployment have separate responsibilities in dev.
The public static bundle contains no SSPs or company content. Tenant/client IDs in `config.json` are public identifiers.

| Boundary | Personal/test now | Work dev prepared by this change | Required production decision |
| --- | --- | --- | --- |
| Web and API ingress | Public SWA Standard with linked Linux Functions | Same public ingress; API still checks every JWT | Assess gateway/WAF/private ingress and prove controls cannot be bypassed |
| Function hosting | Y1 Consumption | EP1 Premium with VNet integration | Size, scale, quota and resilience for actual workload |
| Cosmos and host/package storage | Public network endpoints, Entra access only | Public network disabled; private endpoints and DNS | Validate residency, isolation, egress and recovery |
| Terraform state | Separate Entra-only public storage endpoint | Same, allowing hosted infrastructure agents | Decide whether private state and different bootstrap/agents are required |
| Identities | Existing single WIF connection supported | Three distinct infrastructure/deployment/publisher identities required | Production-only identities, reviewed inherited grants and elevation |
| Localhost/demo | Explicit test options | Both forbidden | Both forbidden |
| Raw browser/permanent deletion | Disabled by default | Disabled by default | Disabled by policy checks; separate admin design to be reviewed |
| Backup/log defaults | Seven-day Cosmos backup; 30-day logs | Seven-day Cosmos backup; 90-day logs | Current minimums are 30-day backup and 90-day logs; approve actual requirements |

The test topology is not a claim that every service is free: Standard SWA and usage can incur costs. Dev adds
Premium hosting and private networking costs. Budgets alert; they do not prevent charges.

Private data networking does **not** make the dev app private. SWA-linked APIs require publicly reachable backends.
Changing API ingress requires an intentional integration redesign, not just disabling a public endpoint. State is
also explicitly public and authenticated in the supplied dev topology. See [Microsoft's SWA API constraints](https://learn.microsoft.com/azure/static-web-apps/apis-overview)
and [Functions networking guidance](https://learn.microsoft.com/azure/azure-functions/functions-networking-options).

## Authentication, sessions and application authorization

`src/api/auth.ts` verifies RS256 signatures using the configured tenant's JWKS, exact issuer and audience, expiry,
required claims, tenant ID, delegated `access_as_user` scope, and a recognized signed app role. The API does not trust
`x-ms-client-principal`, browser-supplied roles, display names, email addresses or request ownership fields as identity.
Functions host authentication is anonymous so the application can perform this JWT validation; that is not an
unauthenticated data API. Direct Function requests still require valid application tokens.

Terraform creates a single-tenant SPA/API registration, requires Enterprise application assignment, defines User,
Security and AppAdmin roles, and explicitly assigns configured users. The browser uses authorization code with PKCE
and no client secret. MSAL uses session storage, explicitly selects the redirect account or the sole cached account,
and requires account selection when ambiguous. Only an interaction-required token error starts reauthentication.

Logout/reauthentication clears the displayed document, baseline, history, identity cache and page state. Requests
from an older session generation cannot restore cleared data. Restored browser-history pages clear and reload to
recheck authorization. These measures do not protect an active session against arbitrary script execution in the
page, a compromised browser/device, or copies already exported by an authorized user.

| Application role or grant | Effective permission |
| --- | --- |
| User | Create private plans; access owned or explicitly shared plans |
| Shared Read | Read current/historical data and validate/export that plan |
| Shared Edit | Read and edit that plan; no sharing administration solely from this grant |
| Owner | Administer sharing, archive and attest their plan as well as edit |
| Security | Tenant-wide SSP access/administration; no AppAdmin routes |
| AppAdmin | Tenant-wide SSP access and staged library administration; raw/delete additionally need their switches |
| OSCAL system role | Documentation/attestation context only; grants no application or Azure access |

`src/api/authz.ts` checks immutable tenant/object IDs and the current stored ACL. Historical access uses the current
ACL too. Inaccessible objects return 404. A plan being permanently deleted is unavailable through ordinary APIs.
Archived plans retain history and are read-only for edits/attestation. Ownership and server metadata cannot be
changed through ordinary document updates; sharing has a separate request schema and permission check.

An Entra role removal does not instantly invalidate already-issued tokens. Plan ACL revocation is checked on the
next API request, but owners/Security/AppAdmin retain their own authority. Company Conditional Access, device policy,
guest restrictions, emergency blocking and privileged elevation require work-tenant decisions and licensing;
they are not created by this module. See [revocation procedures](permissions.md#revocation-and-emergency-access-blocking).

### Directory lookup

The Function identity has Graph **application `User.Read.All`**, a tenant-wide directory-reading permission. The API
uses fixed Graph routes and selected basic fields; it does not forward client URLs, tokens, filters or pagination links.
Search requires plan sharing authority, accepts 3–100 characters and returns at most 20 people. Participant-label
resolution requires plan read access and only resolves existing participants, at most 100 IDs per request. OData
literals are escaped. Sharing additions require a fresh target-tenant lookup; lookup does not invite guests or assign
application roles. Optional display lookup has a bounded cache and timeout.

This API filtering reduces exposure but does not narrow the underlying Graph grant against a compromised runtime.
The tenant team must review that grant and alternatives during work dev. Directory names/contact details are personal
data; actor snapshots retained in history need an approved retention policy.

## Browser content and request protections

The SWA configuration defines CSP with same-origin scripts/styles, constrained Entra connection/frame origins,
`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'` and HTTPS upgrade. It also sets
`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, one-year HSTS and a Permissions Policy disabling
camera, microphone, geolocation and payment. API/config responses use `Cache-Control: no-store` where configured.
SWA headers must be verified after deployment; they are not all reproduced by the local Vite server or automatically
applied to a direct Function response. The API itself sets no-store and nosniff.

Untrusted OSCAL/directory text is escaped by shared rendering helpers or inserted through text nodes. Live directory
labels and SSP-import previews use text nodes. Existing escaped HTML templates remain and require ongoing review;
there is no claim that all `innerHTML` use has been removed or that Trusted Types is enforced. The API accepts bearer
headers rather than an application session cookie. A future cookie/session design needs a fresh CSRF assessment.

## API input, resource limits and concurrency

| Control | Implemented limit/behaviour |
| --- | --- |
| Ordinary request body | 1,000,000 bytes, bounded while streaming before JSON parsing |
| Admin library upload envelope | 20,001,000 bytes only for authenticated AppAdmin POST to the exact library route |
| Single library document | 20,000,000 bytes, schema validated |
| Library | 50 MB and 500 documents, plus bounded metadata/reference rules |
| JSON responses | 60,000,000 bytes; larger serialized responses rejected |
| Plan/revision/attestation pages | At most 25 items; list/revision metadata avoids full OSCAL documents |
| Raw page, if enabled | One record; fixed allowed containers; preview display also truncated |
| Cursor | Opaque continuation value, length bounded to 16,000 characters |
| Authenticated per-process limits | Default 120 total and 10 expensive operations per tenant/user per minute |
| Limiter memory | At most 5,000 active principal windows; deny new principals at capacity |

Nonempty HTTP bodies require JSON content type. Malformed JSON is rejected. Depth/node limits, strict mutation-field
allowlists, official version-pinned schemas and baseline/reference integrity checks supplement byte limits. Server-built
queries use parameters; clients cannot submit SQL or arbitrary container names. Specific historical revisions use
point reads after authorization. Page continuation is not a permission grant and each request is reauthorized.

Writes and raw/export/revision routes consume the expensive allowance. A 429 includes `Retry-After: 60`. Counters
are process-local, reset on recycle and are not a distributed quota, tenant billing cap or volumetric DDoS defence.
They apply after authentication; unauthenticated traffic is not governed by these user counters. A response byte cap
is checked after serialization, so it is not a complete memory-allocation guarantee. Approved content and library
assembly still require memory proportional to the bounded documents; exercise realistic maximums in work dev.

Updates use a client version token and authoritative Cosmos ETags. Transactional batches update the current SSP
and create revision/audit records together; concurrent changes return a conflict. Sharing and attestation use the
same concurrency boundary. Saved revisions include digests. These are application-level history controls: the runtime
has write permission on the SSP container, so history is not storage-enforced WORM evidence.

## Azure identities, storage boundaries and network controls

`infrastructure/identity.tf`, `cosmos.tf`, `functions.tf` and `network.tf` define these boundaries:

| Identity | Grants or responsibility | Material limitation |
| --- | --- | --- |
| Runtime managed identity | Contributor on `ssps` and `staging`; Reader on published `content`; create-only items plus metadata on `audit` | Runtime compromise can alter SSP/staging data and append false audit events |
| Runtime host storage | Blob Data Owner, Queue Data Contributor and Storage Account Contributor, scoped to host account | These are broad host-account privileges; executable packages are deliberately elsewhere |
| Runtime package storage | Blob Data Reader scoped to the separate package container | Cannot replace/delete executable packages through its runtime assignment |
| Deployment identity | Package Blob Contributor and custom Function config/restart/trigger-sync plus SWA token retrieval | Deploying code remains security-critical; this identity can change the running application |
| Publisher identity | Cosmos Contributor on `content`, app-group Reader for endpoint discovery | Can alter/delete published data if compromised; script immutability is not WORM RBAC |
| Infrastructure identity | Scoped resource/role/lock administration, state access and Entra application/assignment administration | Privileged trust root; can reconfigure lower-privilege boundaries |
| End user | Delegated API and plan permissions | No direct Cosmos/storage role from application assignment |

Work dev requires three distinct explicit pipeline object IDs. Deployment/publisher cannot appear in app owners.
The code and publication jobs need no Terraform state or Graph-write grants. Existing broad inherited/manual roles
are not revoked by creating these narrow roles: operators must reconcile them. The infrastructure Graph permissions
`Application.ReadWrite.OwnedBy`, `Application.Read.All` and `AppRoleAssignment.ReadWrite.All` include directory-wide
capabilities and require tenant-admin consent/review. Resource-group scope does not constrain Graph permissions.

Cosmos local authentication and storage shared keys are disabled; storage disallows anonymous nested blob access.
TLS minimums and HTTPS are explicit. FTP and web-deploy basic authentication are disabled. The API uses
`ManagedIdentityCredential`; the publisher uses `AzureCliCredential` after pipeline identity checks so an agent VM's
own managed identity cannot silently become the publisher.

Dev creates an approved /16 VNet, Function integration subnet, private-endpoint subnet, agent subnet, private DNS
zones/links and five data endpoints: host blob/queue/table, package blob and Cosmos SQL. Function outbound routing
uses the VNet. Agent compute/registration is supplied by the company; this repo provides its subnet and required
connectivity instructions. Peered agents also need correct DNS forwarding/links. No company firewall, general egress
allowlist, private API gateway or private state network is provisioned implicitly.

Storage firewall trusted-service bypass stays `None`; private endpoint clients do not require that broader exception.
Infrastructure resource creation uses ARM, allowing the first infra-only run on a hosted agent. Private package upload
and content publication then require an approved network-connected agent. Validate DNS, route behaviour and role
propagation before treating a successful Terraform apply as a working application.

## Administration, controlled content and audit evidence

`allow_raw_browser=false` blocks partition enumeration and raw reads. `allow_permanent_delete=false` blocks every
admin DELETE, including staged library deletion. The UI obtains server capabilities and hides unavailable actions;
the API enforces them independently. These switches do not remove the runtime's underlying SSP/staging write roles
or disable Terraform destruction. Infrastructure destruction has separate controls below.

If deliberately enabled, raw browsing only accepts `ssps` or published `content`, enforces SSP tenancy, and logs
read activity. It does not expose `staging` or `audit`. Permanent SSP deletion requires typed SSP ID and current
version, freezes the record with an ETag, deletes bounded batches, and removes current last. Requested/completed
audit events sit outside the purged partition. A failed purge remains marked as deleting for controlled retry; there
is no in-app undo. Deleting a staged file requires a current registry version and no remaining dependants.

Staged uploads cannot change published releases or become selectable baselines automatically. Validation rejects
unsafe paths, remote/external imports, traversal, cycles, duplicate path/UUID identity and invalid schemas. The
runtime never fetches an uploaded OSCAL reference URL. A registry ETag serializes dependency decisions. Failed chunk
writes can leave unlisted staging data for operator investigation; no arbitrary raw cleanup endpoint is supplied.

Publication validates reviewed source files, resolves profiles with the pinned OSCAL CLI, verifies a release digest,
creates immutable-by-script chunks/manifest and moves the active pointer last. An existing hash-named release must
match byte/content expectations before reuse. Historical SSPs stay pinned to their original release. Runtime Cosmos
RBAC prevents it from editing published content. Publisher RBAC still permits mutation, so approved pipelines,
protected identities and retained evidence remain essential.

The repository includes a pinned official NIST reference-content path and all importer/builder/publisher code; a
separate controlled-content repository is optional. Public NIST material still requires an organization decision to
adopt it. Fictional demo publication is separate and allowed only in test; the local loopback demo is excluded from
the deployed Functions bundle and refuses to start in an Azure Functions instance. There is no production demo-auth
switch. See [content provenance and publication](content.md).

Admin raw reads, staged-document reads/exports, uploads and deletion events go to the separate `audit` container.
Its runtime role can create items but not read, replace or delete existing audit items. Ordinary SSP changes also
have transactional per-plan audit/history. Function telemetry records authorized actor/tenant, operation category
and invocation ID; failures record status and invocation ID. Application logging avoids submitted OSCAL bodies,
search text and credentials. Verify platform/automatic telemetry and retention separately; actor IDs are still data.

There is no SIEM integration, immutable external archive, privileged-operator audit review or tested security-alert
response process delivered by this change. A compromised runtime can forge new audit events; privileged operators
can change Azure roles/resources. Work dev must establish independent retention/correlation and production ownership.

## Configuration and CI/CD protections

`config/test.json` and `config/dev.json` are intentionally incomplete templates. Each pipeline selects one; a protected
Azure DevOps `scribeEnvironment` variable contains the complete effective JSON. The loader rejects unknown keys,
malformed IDs/settings and an environment label that differs from the selected file. It validates subscription,
tenant and configured principal against the authenticated service connection before Azure operations. Dev requires
explicit settings and separate identities; it cannot silently inherit the test fallback.

| Setting group | Policy and purpose |
| --- | --- |
| `allow_demo`, `allow_localhost_redirect` | Forbidden outside test |
| `allow_raw_browser`, `allow_permanent_delete` | False by default; production policy requires false |
| `private_data`, `function_sku`, `vnet_cidr` | Dev requires private data and EP1; choose a non-overlapping company network |
| `infrastructure_object_id`, `deployment_object_id`, `publisher_object_id` | Explicit, distinct work identities; reject wrong connection or app ownership |
| `requests_per_minute`, `expensive_requests_per_minute` | Validated total/expensive request ceilings, with expensive no greater than total |
| `log_retention_days`, `log_daily_cap_gb` | Retention and ingestion controls; caps can reduce visibility and must be sized |
| `backup_retention_days`, `protect_data` | Continuous backup tier and Cosmos deletion lock |
| `allow_destroy` | Separate reviewed test/dev maintenance opt-in; forbidden for prod |
| State identifiers and resource groups | Separate app/state groups; preserve the selected authoritative backend |

Normal work dev requires protection; the deliberate maintenance combination `allow_destroy=true` and
`protect_data=false` permits a reviewed unlock/destruction sequence. Production minimum checks reject destruction,
raw access and permanent deletion, and require 30-day backup/at least 90-day logs. These checks are a floor, not a
complete production policy. There is no selectable prod pipeline/profile in this change.

Push/PR runs build and verify. Deployment defaults to **false**, requires an explicit main-branch run and excludes PRs.
The work profile selects separate variable groups, service connections, environment and private-agent defaults.
Infrastructure planning uses central state and a saved plan; changed plans require review, and dev always requires
review even for an unchanged plan. Work manual validation forbids self-approval. Apply compares saved-plan variables
with the current effective configuration; changed configuration needs a fresh plan/review.

Infrastructure and application jobs share the deployment stage/environment exclusive lock when that check is
configured. The app job verifies a target artifact tied to commit/environment/subscription/tenant/group and file
digests for the API/web artifact. It uploads a hash-named API package, verifies an existing blob before reuse,
configures managed-identity run-from-package, restarts the host and synchronizes triggers. The official SWA task
deploys the built frontend without rebuilding; its token is a masked secret pipeline variable, not a CLI argument.

Digests detect accidental/tampered artifact contents relative to their provenance, but are not independent signed
attestation: someone who controls the pipeline can change both. Azure DevOps artifacts/state/plans can contain
sensitive configuration; restrict readers and retention. Masking a token in logs is not a substitute for protecting
pipeline tasks and agents. Do not run untrusted PR builds on the private privileged deployment pool.

Branch control, independent approvals, exclusive locks, service-connection/variable-group permissions and restrictions
on who can edit them are protected-resource setup requirements in [deployment](deployment.md). Editable YAML alone
cannot enforce them against a privileged pipeline administrator. Content publication is manual and should have its
own approved-connection checks and exclusive lock. Discovery must find exactly one Cosmos account in the selected
application resource group and a valid HTTPS endpoint; zero or multiple matches fail closed. Both publication
pipelines stop on discovery failure, and the publisher refuses an empty endpoint before reading or writing content.

### Dependencies and verification gates

Dependencies use the committed npm lockfile; packaged runtime installation disables install scripts. GitHub actions
are pinned to commit IDs. Terraform, OSCAL CLI and Trivy versions/download digests are pinned; NIST source files use
fixed upstream revisions and SHA-256. Lens modules and official schemas retain their provenance. Update these pins
through reviewed changes rather than silently consuming latest downloads.

CI runs application/security/Lens/pipeline tests, TypeScript and production builds, `npm audit --audit-level=moderate`,
a repository secret scan, HIGH/CRITICAL Terraform checks, Terraform formatting/validation, mocked test/dev profile
plans and deployment packaging. Secret scanning covers the current source tree, not a complete Git history audit.
The IaC scan uses synthetic valid dev values, not actual company credentials. Test's public-data topology is not
represented as private by that scan. Trivy uses its pinned embedded checks; periodically update tool/check versions.

`infrastructure/.trivyignore.yaml` contains one narrowly scoped exception: the storage trusted-service-bypass check
would require relaxing `bypass=None`. Host/package storage uses private endpoints instead. Reassess the exception
if integrations change. A clean scan does not prove absence of vulnerabilities; review unsupported patterns and
new advisories. The official Azure pipeline task also depends on Microsoft's task/container release lifecycle.

## Backup, destruction, migration and rebuild

Cosmos continuous backup is explicit (seven days test/dev by default). A CanNotDelete resource lock protects the
account from control-plane deletion, **not item deletion**. Package storage has versioning and 30-day blob/container
soft deletion. Bootstrap creates state versioning, 30-day soft deletion and a separate deletion lock. State and app
resource groups are deliberately separate. None of this constitutes a completed restore test or business-approved RPO/RTO.

For a disposable existing test installation, the recommended clean transition is:

1. Export/back up anything required and record the actual deployed old commit and backend.
2. Run the **Operations pipeline (`pipelines/operations.yml`) with `action: destroy` from the old deployed revision**;
   review its saved plan and confirm success. This means the pipeline, not manual deletion in the Azure portal.
3. Keep the authoritative state backend and administrator-created resource groups.
4. Run **Build and deploy (`azure-pipelines.yml`)** from the hardened revision with `config/test.json`, `deploy: true`;
   publish appropriate content separately and perform acceptance tests.

For later destruction of the hardened version, the runbook first requires both maintenance switches and a reviewed
infra-only apply removing the Cosmos lock, then the Operations pipeline's newly reviewed `action: destroy` run.
Restore safe switches before rebuilding. Terraform can remove a lock it manages, so a lock alone is not a destruction
approval. Never delete or switch state to hide a failed operation.

A complete backend/resource-group teardown is a **separate optional manual administrator procedure in the Azure
portal**, only after successful Operations pipeline destruction; it is not needed for these application changes.
Follow the exact [deployment runbook](deployment.md), including Entra/auxiliary-resource checks.

This revision separates staged files/admin audit from the old mixed `content` container and introduces separate
package storage. It does not migrate old staged assets/audit events automatically. Existing SSP/release containers
are retained by ordinary upgrade, but the disposable rebuild avoids incomplete migration assumptions. If data must
be preserved, test an explicit migration and database restore first. An SSP JSON export alone does not preserve ACLs,
revision history, attestations or all referenced releases. API/frontend paging contracts change together and must be
deployed together; there is no general automatic application rollback or data migration framework.

## Evidence and outstanding security work

Local verification for this hardening iteration covers authentication/authorization regressions, disabled admin
capabilities, request limiting, paginated metadata, revision isolation, profile/identity validation, saved-plan variable
mismatch, artifact modification/symlinks, Terraform graph/profile checks, production packaging and pinned NIST content
resolution. A browser check exercises local plan creation and display; it does not exercise real Entra or Azure networking.
No Azure apply, destruction, deployment or live acceptance test was performed as part of this code preparation.

Work-dev acceptance must record the exact deployed commit and prove at least:

- Real sign-in, tenant/role/ACL boundaries for current and historical data, role revocation delay and logout behaviour.
- Server rejection of disabled raw/delete calls and effective Cosmos/package write denials for the runtime identity.
- Publisher/deployer separation, inherited-role review, audit create-only behaviour and actual private endpoint/DNS access.
- Maximum-size workflows, cursor paging, malformed inputs, rate limits and concurrent updates under realistic load.
- Initial deployment, content publication, failed publication/deployment, recovery and Operations pipeline rebuild.
- Database restoration of SSP history, staged assets and historical content, with measured recovery objectives.

Before production, resolve or explicitly accept the remaining risks with accountable owners:

| Outstanding decision/control | Why it remains material |
| --- | --- |
| Shared/gateway abuse limits and ingress controls | Per-process authenticated counters do not cover scale-out or unauthenticated floods |
| Separate admin identity/API and controlled elevation | Current runtime can mutate SSP/staging data; AppAdmin is a standing token role |
| Independent audit retention and alert response | Create-only runtime RBAC does not constrain operators or prevent fabricated events |
| Token/session and guest/Conditional Access policy | Existing JWTs outlive assignment removal; device/browser compromise remains a risk |
| Graph permission reduction and infrastructure privilege review | Current directory-read and assignment-management permissions are broad |
| Private state, approved egress and company network integration | Supplied dev isolates data, not every network/control-plane boundary |
| Tested recovery, retention, residency and production capacity | Configured backup/locks are not proof of successful recovery or acceptable downtime |
| Ongoing dependency and application testing | The application is unfinished; future features can change these assumptions |

The [work-dev guide](work-dev.md) assigns setup/acceptance work and the [before-production guide](before-production.md)
expands the release gates. Re-review this document whenever identity, authorization, admin features, file handling,
dependencies, hosting, networking or pipelines change, and again at completion of work-environment development.
