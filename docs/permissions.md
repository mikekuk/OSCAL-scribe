# Identity, permissions and access administration

Scribe uses Microsoft Entra sign-in plus server-enforced, per-plan permissions. There is no separate Scribe password database. An Azure subscription role, an Entra app role and a system role written in an SSP are different things.

## Find the app registration and Enterprise application

**Both exist in the personal deployment.** They were verified on 2 October 2026:

| Entra object | Display name | Purpose |
| --- | --- | --- |
| App registration (application object) | `oscal-scribe-u72bee test` | Defines the SPA callback, API scope and application roles. |
| Enterprise application (service principal) | `oscal-scribe-u72bee test` | The tenant-local instance where people are assigned access. `Assignment required` is enabled. |

They share application/client ID `05d6c433-b823-413d-8e04-791a4d293082` but have different **object IDs**. App registration object ID: `d5062ce3-7eae-4f96-a244-205ea3688d23`. Enterprise application object ID: `a44345fc-8df8-402e-acc3-f96eec167b1d`. These identifiers are not passwords or client secrets. A fresh deployment generates new IDs.

To find the current personal objects:

1. Open the [Microsoft Entra admin center](https://entra.microsoft.com/) and switch to the directory associated with the personal Azure subscription. Its tenant ID is `f9d69abf-4b1d-48c4-b5ec-4ac3f9210503`; selecting a subscription in the Azure portal does not necessarily change the directory shown in Entra.
2. Open **Entra ID → Enterprise apps / Enterprise applications → All applications**. Clear restrictive filters and search `oscal-scribe-u72bee test`, or use the application ID above.
3. Open **Users and groups** to see assigned users and roles. The personal test account has the `Security` role.
4. Separately, open **App registrations → All applications**, locate the same name/client ID, then inspect **Authentication**, **Expose an API** and **App roles**. You can also follow **Managed application in local directory** from the registration to its Enterprise application.

These objects are directory resources, so they do not appear as ordinary resources inside `rg-oscal-scribe-test`. A service principal is the object shown under Enterprise applications; there is no third object called an “Enterprise App registration.” Microsoft explains this distinction in [application objects and service principals](https://learn.microsoft.com/en-us/entra/identity-platform/app-objects-and-service-principals).

For any deployment, inspect the IDs without guessing names:

```sh
scribe_client_id=$(terraform -chdir=infrastructure output -raw client_id)
terraform -chdir=infrastructure output -raw tenant_id
az ad app show --id "$scribe_client_id" \
  --query '{name:displayName,clientId:appId,appObjectId:id,redirects:spa.redirectUris}' -o json
az ad sp show --id "$scribe_client_id" \
  --query '{name:displayName,clientId:appId,enterpriseObjectId:id,assignmentRequired:appRoleAssignmentRequired,enabled:accountEnabled}' -o json
scribe_enterprise_id=$(az ad sp show --id "$scribe_client_id" --query id -o tsv)
az rest --method get \
  --url "https://graph.microsoft.com/v1.0/servicePrincipals/$scribe_enterprise_id/appRoleAssignedTo" \
  --query 'value[].{principal:principalDisplayName,objectId:principalId,type:principalType,role:appRoleId}' -o table
```

Run these using a login in the target tenant with directory read permission. A not-found result in another directory does not show that the application was never created.

## Four separate permission layers

| Layer | Managed where | What it controls |
| --- | --- | --- |
| Permission to enter Scribe | Enterprise application → Users and groups; Terraform `identity.tf` | Whether an Entra user is assigned `Scribe User` or `Security`. |
| Permission to a particular SSP | Scribe → plan → Overview → Sharing | Read/edit grants stored against immutable target-tenant user object IDs. Owner and Security users administer plans. |
| People accountable for the system | Scribe → People & Roles | System Security Officer, Senior Risk Owner, Security Architect, SSP Preparer. These are OSCAL document assignments; they grant no application access. |
| Azure deployment/data access | Azure IAM, Cosmos data RBAC and Terraform | What operators, the Function managed identity and content publishers can do to infrastructure/data. These do not automatically grant Scribe user access. |

### End-user application roles

| Assigned role | Token value | Effective application access |
| --- | --- | --- |
| Scribe User | `User` | Can create plans. Can access owned plans and plans explicitly shared with their object ID. |
| Security | `Security` | Can access and administer all plans in this deployment's tenant. This is an application role, not Microsoft Entra's built-in Security Administrator role. |
| No role | None | Cannot use the Scribe API, even if the public homepage is visible or Microsoft sign-in succeeds elsewhere. |

The API checks the token signature, issuer, audience, tenant, required claims, delegated `access_as_user` scope and one of the expected roles. It does not trust browser-supplied identity headers. The frontend is a public SPA using authorization code + PKCE; it has **no client secret**. A single app registration defines both the SPA and its API scope. Terraform preauthorizes the SPA for that scope; tenant consent policy can still require an administrator's action.

### Per-plan access

After the user passes the Entra/app-role checks:

| Action | Owner | Security | Shared Edit | Shared Read |
| --- | --- | --- | --- | --- |
| View current plan, validate/export and read history | Yes | Yes | Yes | Yes |
| Edit/save a new revision | Yes | Yes | Yes | No |
| Add/remove sharing grants | Yes | Yes | No | No |
| Attest or archive a plan | Yes | Yes | No | No |

Archived plans cannot be edited or attested. History uses the current plan's access rules, so an old revision URL does not bypass revocation. The server returns not-found for inaccessible plan reads rather than exposing their existence. A Security user remains able to access a plan even after a per-plan sharing entry is removed.

Attestation records the authorized actor, a declared system role, saved revision and digest. It is not a cryptographic personal signature, and typing someone into People & Roles neither logs them in nor grants them permission to attest. The current authorization gate is owner/Security; it does not require the chosen fictional/document role to be mapped to that user's Entra object ID.

## Add, change or remove access

### Preferred: manage app assignments in Terraform

Find the person's **user object ID in the target tenant** under Entra ID → Users → the user → Overview. For a guest, use the guest object ID in that tenant, not the person's home-tenant ID. Do not use an email address, subscription ID or app client ID.

Edit the deployment's private tfvars, retaining the other intended users:

```hcl
security_user_ids = ["<TARGET-TENANT-SECURITY-USER-OBJECT-ID>"]
user_ids          = ["<TARGET-TENANT-ORDINARY-USER-OBJECT-ID>"]
```

Run `terraform plan -var-file=test.tfvars -out=access.tfplan` from `infrastructure` (or use `-chdir=infrastructure` from the repository root), review the assignment changes and apply the saved plan. To revoke a Terraform-managed assignment, remove the object ID from the relevant set and apply a reviewed plan. Assign only one intended role; if a person has both, Security wins.

This template assigns individual users. Group-based Enterprise app assignment is an optional company extension, subject to Entra licensing and group membership rules; there is currently no dedicated group-assignment variable or group-based SSP sharing mechanism in Scribe.

### Portal administration

An authorized administrator can use **Enterprise application → Users and groups → Add user/group → select user → Select a role → Scribe User or Security → Assign**. See Microsoft's [assignment procedure and prerequisites](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/assign-user-or-group-access-portal). Do not assign an unspecified Default Access role; the API expects `User` or `Security`.

Choose one source of truth. If you remove a Terraform-managed assignment only in the portal, a later Terraform apply can recreate it. A portal-only assignment is not automatically imported into Terraform, and an empty Terraform user set does not revoke every unmanaged assignment. Reconcile portal additions/removals with the configuration/state or document the separately administered population.

Once assigned, have the user sign out/in to obtain fresh role claims. For a Scribe User to access another person's plan, the owner or a Security user must also open that plan's **Overview → Sharing**, enter the user's object ID and choose Read or Edit. The current owner is not transferred by changing document roles or adding a sharing entry; there is no owner-transfer UI in this version.

### Revocation and emergency access blocking

- **One plan:** remove its sharing entry. Later API requests check the current stored ACL, including historical revisions. This does not remove owner or Security access.
- **All Scribe access:** remove every Enterprise app role assignment granting that user access, including group-based grants if introduced. Update Terraform too. Existing tokens carry role claims until they expire; the API does not query Graph on every request. Do not describe Entra role removal as instant revocation of already-issued tokens.
- **Immediate whole-service outage:** stop the Function App using the [shutdown runbook](deployment.md#stop-and-restart-without-deleting-data). Disabling Enterprise app sign-in prevents new sign-ins/token acquisition but does not itself stop costs or guarantee immediate rejection of all existing tokens.

## Azure resource permissions are separate

| Identity | Current template grants / required capability | Not granted automatically |
| --- | --- | --- |
| Bootstrap/infrastructure operator | Must already be able to create resources and role assignments in the target Azure scope, and manage the target Entra app/service principal/user assignments. | Azure Owner does not confer Entra directory administration; Entra admin does not confer subscription permissions. |
| Function App system-assigned managed identity | Cosmos Data Contributor scoped to `scribe/ssps`; Cosmos Data Reader scoped to `scribe/content`; runtime storage roles on this deployment's storage account. | Cannot publish controlled content. Browser users never receive its credentials or Cosmos keys. |
| `publisher_object_id` | Cosmos Data Contributor scoped to `scribe/content`; Storage Blob Data Contributor on the Function storage account. | No SSP-container data grant and no permission to change Function/SWA settings just from these two grants. |
| Application deployment operator/job | Needs package blob upload, Function configuration/restart, SWA deployment-token retrieval and access to Terraform outputs/state. Azure Contributor at the app resource-group scope covers management operations; blob **data** access must also be assigned. | The deployment script does not grant these permissions to itself. |
| Scribe end user | Enterprise app role plus plan permissions. | Does not need Azure portal, subscription IAM or direct Cosmos access. |

Runtime storage roles currently include Storage Blob Data Owner, Storage Queue Data Contributor and Storage Account Contributor, scoped to the Function storage account. They support the Functions host and private package access. Cosmos local/key authentication is disabled; data access uses Entra identities and container-scoped Cosmos data roles.

The personal test uses the signed-in operator as the publisher and a Security user. For company separation of duties, use distinct deployment and publication service identities and split the current `publisher_object_id` grants in `functions.tf` and `cosmos.tf`. Pipeline identities need explicitly configured Azure permissions and, for infrastructure that manages Entra, appropriate directory/Graph permissions and admin consent. Do not grant every service connection tenant-wide administration as a shortcut.

## Troubleshooting access

| Symptom | Check |
| --- | --- |
| Cannot find Enterprise app | Correct tenant; All applications; cleared filters; exact name/client ID. Verify with `az ad sp show`. |
| Assigned in Azure IAM but cannot use Scribe | IAM is not the Scribe Enterprise app assignment. Assign the appropriate app role. |
| Microsoft sign-in reports assignment required | Assign the target-tenant user to Scribe User or Security on the correct Enterprise app. |
| Admin approval required | Ask the tenant administrator to review/consent to the Scribe delegated scope; do not disable assignment or token validation to bypass policy. |
| App opens but an existing plan is missing | User has app entry but lacks ownership/sharing, or is in the wrong deployment. Check immutable object IDs. |
| Added a person under People & Roles, but they cannot sign in | Those fields are documentation only. Assign their Entra app role and, when needed, share the plan. |
| Content publication returns 403 | Check the publishing identity, `COSMOS_ENDPOINT`, container-scoped Cosmos data role and propagation. A Scribe Security role does not grant direct database publication. |

Read [the deployment runbook](deployment.md) before deleting or moving the environment. Resource-group deletion alone does not remove these directory objects.
