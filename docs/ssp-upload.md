# Upload a downloaded SSP

All signed-in app roles (**User**, **Security**, **App Admin**) can select **Upload SSP** from their Plans/home screen. App Admin's paged Plans screen has the same option. **What can I upload?** opens an accessible help dialog with requirements and copy behavior. Choose a file, select **Check file**, review the original baseline, then select **Import as a new copy**.

Supported input is an OSCAL 1.2.2 `system-security-plan` JSON export from Scribe, including a saved revision download, up to 1 MB. Upload the OSCAL file itself, not a Cosmos current/revision record wrapper. PDF, XML and ZIP are not supported. This first version restores Scribe exports; it does not resolve arbitrary external OSCAL profile imports.

The original `import-profile.href` must be a Scribe release/profile reference, and that exact published release and profile must exist in the destination environment. The current active release may differ. The server never fetches URLs from the file, substitutes a new baseline, or trusts a browser-supplied profile choice. When the source release is missing, an administrator must restore or publish the exact source content through the controlled-content process before retrying. The reference is not rewritten to a different release.

Schema and application reference validation run on preview and again on import. The document must cover the exact pinned baseline with valid supported references and contain exactly one `this-system` component. Invalid or oversized uploads create no plan. The standard 1 MB API request and document-complexity limits remain in place; very near-limit JSON may exceed the request limit once wrapped. Keep exports below the limit. No new infrastructure, Graph permission or runtime configuration is required.

## Copy and access behavior

Every upload creates a new private app record owned by the authenticated uploader in their tenant, with a new SSP document UUID, revision/version 1 and current modification time. Existing SSPs are never overwritten, even when the uploaded source UUID already exists or belongs to someone else. Uploading twice deliberately creates two copies. The browser disables duplicate submissions while a request is pending; after an interrupted response, check Plans before retrying.

Component/party UUIDs, implementation narratives and statuses, system identifiers and other OSCAL content are retained. Local fragment links to the document's old root UUID are updated to the new UUID. A standard `metadata.links` entry with `rel: derived-from` records the source SSP UUID. The import audit stores the original document hash and UUID. These source identifiers document lineage, not proof of authorship or authenticity.

Application sharing grants, ownership, saved revision history, archive state and attestation records are not imported. Imported OSCAL statements or narrative claims do not count as a Scribe app attestation. The uploader must review, share and attest the new copy as appropriate. The first revision attributes the import to the authenticated uploader, using the same server-derived name snapshot as ordinary saves. Historical source revisions remain unchanged.

## API and verification

`POST /api/ssps/import/preview` accepts `{oscal}` and returns title, system name, pinned profile title, release ID and source UUID without writing. `POST /api/ssps/import` accepts the same body and atomically creates the current record, initial revision and import audit. Both require an assigned app role. Fields such as ownerId/access are rejected, and app permissions are never read from file metadata.

Tests cover all three app roles, old pinned releases, preview without writes, repeated imports, cross-tenant source UUID collisions, spoofed ownership, invalid profiles/controls/types, malformed and oversized documents, source immutability and local root-link remapping. The upload/help flow is also checked with synthetic files in the local preview.
