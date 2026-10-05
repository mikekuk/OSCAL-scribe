# Threat model and release gates

For operator steps, see [identity and permissions](permissions.md) and the [deployment, shutdown and rebuild runbook](deployment.md).

Trust boundaries: browser -> Entra -> verified Function API -> Cosmos; separately, approved Git content -> publication job -> immutable published content; separately, verified AppAdmin -> staged library and admin audit. No browser data is identity evidence. System roles and app authorization roles are independent. API JWT verification remains mandatory even if SWA backend linking restricts direct API traffic.

Threats and controls:

- BOLA/IDOR: common authorization module before every current/historical operation; lists are scoped by immutable tenant/object IDs and ACL. Inaccessible objects return 404.
- Privilege escalation/mass assignment: strict request allowlists, separate sharing operation, immutable owner/creator fields, signed Entra application roles only.
- Injection/XSS: parameterized server queries; no query endpoints; Lens escapes prose and parameter text; CSP; no content HTML execution.
- Malformed/excessive JSON: bounded streaming read, depth/node/byte limits, version-pinned official schema, exact baseline and reference integrity checks.
- Lost updates/history tampering: ETag conditional Cosmos transactional batches create immutable revision/audit alongside current changes. Sharing uses the same concurrency boundary. Attestation contains exact revision and SHA-256 digest.
- Supply chain/content SSRF: pinned upstream data, schema provenance, pinned CLI checksum, approved local import closure, versioned content digest, active pointer only after complete validated upload.
- Data disclosure: no content in telemetry; private Cosmos credentials never reach browser; managed identity, container-scoped data permissions, no API controlled-content mutation, TLS.
- Demo bypass: separate loopback-only script, not part of production Functions bundle; deployment never sets a demo-auth environment switch.

Server tests gate private-plan read/edit/share/archive/history/attestation denial, shared read/edit semantics, Security role, cross-tenant denial, mass assignment, revision consistency, revoked access, untrusted tokens and malformed content. Inherited Lens tests cover import cycles, selections, parameter semantics, alterations, escaping and provenance.

Remaining operational verification is explicit: real Entra policies/assignments, Cosmos ETag batch behavior, Function managed-identity runtime/package access, deployment auth boundary and budget billing currency require a live Azure acceptance run. A localhost test suite cannot establish those properties. Profile resolution is delegated to the pinned OSCAL CLI; do not claim universal resolver conformance from baseline tests alone. Parameter constraints are displayed; semantic satisfaction and control effectiveness require human review. Attestation records a declared system role and authorized actor; it is not a cryptographic personal signature.

For company production add organization-required network isolation, retention/backup policies, alert routing, identity review, dependency scanning and operational ownership based on the actual threat model. SWA linked APIs require public backend reachability; do not silently deploy private endpoints that break that integration.


AppAdmin is a distinct Entra token role. Only AppAdmin can browse raw Scribe documents, delete SSP partitions or mutate the staged library. Security/owners cannot invoke those routes; tenant checks remain mandatory for SSP data. Browser input never supplies authorization. Terraform and the reviewed deployment pipeline manage this role and its optional assignments.

Raw storage is read-only, container-allowlisted and cursor-paged; no SQL or arbitrary database/container is accepted. SSP purge checks typed ID and version, freezes writes using an ETag, and supports retries for partially deleted partitions. Requested/completed admin audit events live outside the deleted SSP partition. Upload validation, local-only reference resolution, cycle checks, immutable path/UUID identity and registry ETags protect staged library changes. Referenced uploads cannot be deleted. Published releases stay immutable; uploads require review and the pinned CLI publication pipeline before use by new plans. See [App Admin](app-admin.md) for limits and operational recovery details.
