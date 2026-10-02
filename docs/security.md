# Threat model and release gates

For operator steps, see [identity and permissions](permissions.md) and the [deployment, shutdown and rebuild runbook](deployment.md).

Trust boundaries: browser -> Entra -> verified Function API -> Cosmos; separately, approved Git content -> publication job -> read-only application content. No browser data is identity evidence. System roles and app authorization roles are independent. API JWT verification remains mandatory even if SWA backend linking restricts direct API traffic.

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
