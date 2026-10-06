# Directory names and sharing

Scribe stores Entra object IDs in ownership, sharing and audit records. Names and email addresses are display information, never authorization keys. Changing a name or address does not transfer access.

## User experience

On **Overview → Sharing**, type at least three characters of a name, email address or sign-in name. Searches match the beginning of these fields, wait 350 ms after typing, and return at most 20 people. Refine the search if the desired person is absent. Select a result, choose Read or Edit and click Share. Duplicate names are distinguished by email or sign-in name. Existing tenant guests appear with a Guest label; this workflow cannot invite users. Sharing does not assign the Scribe enterprise-application role, which is still required to sign in.

Owners and sharing entries show the resolved display name and email (or sign-in name when mail is absent). Identity details exposes the underlying UUID. Unknown/deleted users display **User unavailable**; IDs remain available for investigation and access can still be revoked. Guest sign-in names may contain `#EXT#`; they are not reconstructed into guessed email addresses.

Revision history shows **Saved by** with the actor's name. New revisions and attestations save a server-sourced `actorIdentity` snapshot next to the immutable actor ID, outside the OSCAL document. A rename does not rewrite that snapshot. Older revisions without snapshots can display a current directory name; no historical records are rewritten. Names recorded at save time are labelled accordingly. If Graph is unavailable while saving, verified name/sign-in claims are used when present; otherwise the ID is retained and can be resolved later. These labels do not alter revision hashes, OSCAL parties or sharing rights.

## Pipeline and consent

The existing Build and deploy Terraform step grants Microsoft Graph **application `User.Read.All`** to the Function's **system-assigned managed identity**, using `azuread_app_role_assignment.directory_reader`. The resource looks up Microsoft Graph's existing service principal and its named application role. No secret, browser Graph token or delegated Graph scope is added. The single configured `ENTRA_TENANT_ID` is checked before every directory call.

Microsoft documents `User.Read.All` as the least-privileged **application** permission for [listing users](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0). It permits broader user-profile reads than the fields this feature uses: Scribe selects only `id`, `displayName`, `mail`, `userPrincipalName`, and `userType`. It grants no directory write, invitation, group membership or app-assignment capability to the Function.

Review this directory-wide read grant in the pipeline's normal infrastructure approval gate. The infrastructure service connection's consented `Application.Read.All` and `AppRoleAssignment.ReadWrite.All` permissions allow looking up Graph and granting this application role; `Application.ReadWrite.OwnedBy` remains needed for the existing Scribe app deployment. A tenant administrator must approve these deployment permissions as described in [deployment setup](deployment.md#subscription-and-pipeline-setup-details). Applying the Graph app-role assignment is the runtime admin-consent grant; merely deploying frontend code is not enough. Verify the managed identity has `User.Read.All` after apply and allow for propagation before live acceptance testing. No manual Azure CLI grant is part of this feature's setup.

## Boundaries and failures

- `POST /api/ssps/{id}/people` accepts only a `query` and requires permission to manage sharing on that SSP. It uses fixed Graph routes and safely escaped, URL-encoded prefix filters. Search requests and result data are not logged.
- `POST /api/ssps/{id}/identities` resolves at most 100 IDs already present as owner, sharing recipient, current modifier, last attestor or revision author of a readable SSP. It cannot resolve arbitrary directory IDs. Historical author checks query actor metadata only, not whole OSCAL revisions.
- Lookups cache up to 1,000 IDs per Function instance for five minutes. Names can lag directory changes by that interval. Resolution has at most five concurrent Graph requests and stops scheduling further batches when the directory is unavailable. Labels load asynchronously without delaying the editor or resetting unsaved inputs. Graph HTTP requests have an eight-second timeout; provider errors return a sanitized unavailable message.
- Every new/updated sharing grant does a fresh tenant lookup, bypassing the identity cache. Deleted users and directory failures block new grants. Existing sharing rights, SSP reads/saves and removal of access do not depend on Graph availability. Disabled accounts remain subject to Entra sign-in enforcement; search is not a promise that the user can sign in.
- Names and addresses are escaped in the UI. Snapshot names/email become personal data retained alongside revision history; they share its retention/deletion lifecycle. This does not modify historical rows or export names as OSCAL document authors.

## Verification

Automated coverage includes authorization boundaries, cross-tenant rejection, existing guests, absent mail, deleted users, immutable name snapshots, outage-safe saving/revocation, cache bypass, escaped filters, result limits and safe rendering. The loopback demo provides fictional people only. Before production rollout, exercise member and guest searches with the managed identity in the target tenant, sharing to an app-assigned recipient, revoked access, and a new saved revision. Local tests do not prove live Graph consent.
