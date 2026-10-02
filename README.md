# OSCAL Scribe

Entra-authenticated security planning on Azure Static Web Apps, Functions and Cosmos DB. SSPs remain OSCAL documents, with immutable revisions, sharing, revision-specific attestation and controlled content releases.

The implementation reuses OSCAL Lens modules pinned at `f4156824e76a776c1f9bb684a103f0ec78fd0e5f`. Lens is not modified. Its preview is not used as authoritative profile resolution; the pinned OSCAL CLI resolves approved profiles before publication.

## Local demonstration

Requires Node 22+, Java 21+, curl and unzip.

```sh
npm ci
bash scripts/install-oscal-cli.sh
npm run demo:prepare
OSCAL_CLI="$PWD/work/oscal-cli/bin/oscal-cli" npm run content:build
npm run demo
# In another terminal:
npm run dev
```

Open http://127.0.0.1:5173. This explicit local demo uses an in-memory repository and a fixed fictional identity, binds only to loopback and is never included in the Azure Functions deployment. Restarting the demo API clears SSPs. Production always requires a verified Entra access token.

The separate importer downloads official SP800-53 Revision 5.2.0 content pinned to an upstream commit: Low (149 controls) and Moderate (287 controls). “Medium” corresponds to NIST Moderate. A fictional company SOC contributes to AU-2, AU-6, AU-12, IR-4, IR-5, IR-6 and SI-4, with partial/shared responsibilities. It makes no compliance claim.

## Checks

```sh
npm run check
terraform -chdir=infrastructure init -backend=false
terraform -chdir=infrastructure validate
```

Prepare the demo content first: OSCAL tests use the real catalogue and profiles. Tests cover object-level authorization, sharing boundaries, immutable revisions, attestation, token verification, malformed input, NIST baseline coverage and inherited Lens import/tailoring/rendering regressions. `npm run build` type-checks and produces the static site plus the Functions entry point.

## Deploy

See the [Azure deployment, shutdown and rebuild runbook](docs/deployment.md) for stopping/restarting, deleting, rebuilding from Git and deploying into another tenant/subscription. See [identity and permissions](docs/permissions.md) to find the Enterprise application and administer access. Application, infrastructure and controlled content are separate deployment paths. No Azure DevOps organization is needed for local CLI deployment; Azure Pipelines templates support later migration. GitHub Actions runs verification on pushes and pull requests.

- [Architecture assessment and design](docs/architecture.md)
- [API contract](docs/api.md)
- [Threat model and release checks](docs/security.md)
- [Demo lifecycle](demo/README.md)
- [Third-party provenance](THIRD_PARTY_NOTICES.md)

## Boundaries

The UI supports the initial SSP workflow; it is not an assessment/compliance certification tool. Schema and referential validation do not prove control effectiveness or satisfy all ODP constraints. All approved content is JSON. Supported schema versions are explicit in `src/shared/validation.ts`; unsupported versions fail publication rather than silently falling back.

Deployment acceptance must verify real Entra sign-in, Cosmos transactional behavior and read/edit/security identities in the target tenant. Local tests cannot prove the deployed Azure trust boundary. See the runbook for the release checklist. The application shell and sign-in assets are public; SSP and controlled-content API responses require validated single-tenant access tokens. No SSP content is built into the static bundle.
