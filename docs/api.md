# API contract

Every production endpoint requires `Authorization: Bearer <Entra delegated access token>` with issuer/tenant/audience/signature/expiry validation, `access_as_user` scope and User or Security app role. Browser identity headers, email, display name and request owner IDs are not trusted.

| Method | Path | Operation |
|---|---|---|
| GET | /api/me | Trusted caller identifiers and application roles |
| GET | /api/content | Active approved release, profile list, component definitions |
| GET | /api/content/{release}/{profile} | Immutable resolved baseline and original sources |
| GET | /api/ssps | Caller-accessible plan summaries |
| POST | /api/ssps | `{releaseId,profileId,systemName}` |
| GET | /api/ssps/{uuid} | Current plan and server-managed metadata |
| PUT | /api/ssps/{uuid} | `{oscal}`; creates a revision |
| POST | /api/ssps/{uuid}/share | `{oid,permission:read|edit|remove}` |
| POST | /api/ssps/{uuid}/archive | `{}`; preserves all records |
| GET | /api/ssps/{uuid}/revisions | Revision metadata |
| GET | /api/ssps/{uuid}/revisions/{number} | Historical OSCAL, actor, timestamp and digest |
| GET | /api/ssps/{uuid}/attestations | Immutable attestation records |
| POST | /api/ssps/{uuid}/attest | `{revision,systemRole}`; current saved revision only |
| POST | /api/ssps/{uuid}/validate | `{oscal?}`; saved document if omitted |

Mutating an existing SSP requires `If-Match` containing its numeric `version`. This metadata version also increments on sharing/archive/attestation, while `currentRevision` increments only on OSCAL saves. Cosmos conditional batch applies the authoritative ETag internally. Concurrent changes return 409, never silently overwrite. Clients must reload and reconcile.

Owners/Security manage sharing, archive and attestation. Editors can save OSCAL; readers can view, validate and export. Historical reads check current ACL, so revocation applies to every revision. Inaccessible SSP identifiers return 404. Archived plans are read-only and retain history. All four system roles must be assigned before attesting. The recorded system role is the attester's declaration; it does not grant application access.

Normal updates reject unrecognized fields. Ownership, ACL, tenant, creation fields and revision records cannot be mass-assigned. Requests are limited to 1 MB before parsing, plus depth/node bounds. Arbitrary query strings, container names and database commands are never accepted. All stored SSP documents must pass the pinned NIST schema and profile/reference integrity checks.

Export retains a stable `urn:oscal-scribe:<release>:<profile>` import. The pinned-content download contains the corresponding original profile, imported sources and resolved catalogue, allowing an external consumer to map that URN. A standalone SSP JSON is portable OSCAL but consumers must also receive its pinned baseline to interpret the controls.
