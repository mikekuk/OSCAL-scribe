# API contract

Every production endpoint requires `Authorization: Bearer <Entra delegated access token>` with issuer/tenant/audience/signature/expiry validation, `access_as_user` scope and User, Security or AppAdmin app role. Browser identity headers, email, display name and request owner IDs are not trusted.

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

Owners/Security/AppAdmin manage sharing, archive and attestation. Editors can save OSCAL; readers can view, validate and export. Historical reads check current ACL, so revocation applies to every revision. Inaccessible SSP identifiers return 404. Archived plans are read-only and retain history. Every role currently defined in the saved SSP must have a person assigned before attesting. The attesting role must exist in that revision; roles deleted from the plan are no longer required. The recorded system role is the attester's declaration; it does not grant application access.

Normal updates reject unrecognized fields. Ownership, ACL, tenant, creation fields and revision records cannot be mass-assigned. Requests are limited to 1 MB before parsing, plus depth/node bounds. Arbitrary query strings, container names and database commands are never accepted. All stored SSP documents must pass the pinned NIST schema and profile/reference integrity checks.

Export retains a stable `urn:oscal-scribe:<release>:<profile>` import. The pinned-content download contains the corresponding original profile, imported sources and resolved catalogue, allowing an external consumer to map that URN. A standalone SSP JSON is portable OSCAL but consumers must also receive its pinned baseline to interpret the controls.

## App Admin endpoints

All `/api/admin` routes require the verified `AppAdmin` app role. They accept no client SQL. SSP operations additionally enforce tenant identity.

| Method | Route | Purpose |
| --- | --- | --- |
| GET/POST | /api/admin/ssps | Up to 25 tenant SSP summaries; POST `{query?, state?, cursor?}` supports search and resumable deletion filters |
| DELETE | /api/admin/ssps/:id | Purge the full SSP partition; body `{confirm: SSP_ID, version}` |
| GET/POST | /api/admin/partitions | Up to 25 content partition IDs; POST `{query?, cursor?}` |
| POST | /api/admin/raw | Read one page using `{container: "ssps" or "content", partition, query?, cursor?}` |
| GET | /api/admin/library | Registry version, document metadata and reference problems |
| POST | /api/admin/library | Validate and stage `{path, doc}`; up to 20 MB per OSCAL document |
| GET | /api/admin/library/:id | Decode a staged OSCAL document |
| DELETE | /api/admin/library/:id | Delete an unreferenced upload using `{confirm: PATH, version: LIBRARY_VERSION}` |
| GET | /api/admin/library/export | Export resolved source bundle for the controlled publication pipeline |

Other requests retain their 1 MB limit; only authenticated AppAdmin library uploads get the larger bounded limit. DELETE does not require an `If-Match` header: its body carries the loaded version and the storage layer enforces ETags. Deletion conflicts return 409; invalid schemas/references return 422. There is no raw-edit or published-release-delete endpoint. See [admin/reference semantics](app-admin.md).

Directory endpoints (same delegated Scribe authentication): `POST /ssps/{id}/people` with `{query}` requires sharing administration and returns up to 20 directory people; `POST /ssps/{id}/identities` with `{ids}` requires plan read access and resolves only existing participants (maximum 100 IDs). Sharing continues to accept `{oid, permission}`; read/edit grants now require a fresh target-tenant lookup. See [directory sharing](directory-sharing.md).

SSP uploads: `POST /ssps/import/preview` and `POST /ssps/import`, each with `{oscal}`, are available to User, Security and AppAdmin. Preview validates without writing; import creates a new private copy against its original available release/profile. Existing SSPs are never replaced. See [SSP upload](ssp-upload.md) for formats, limits and retained content.
