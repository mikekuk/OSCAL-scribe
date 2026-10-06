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

The separate demo pipeline publishes a seven-control SOC worked example selected from pinned NIST SP800-53 Revision 5.2.0 content: AU-2, AU-6, AU-12, IR-4, IR-5, IR-6 and SI-4. It includes assigned ODPs, five added statement-context sections and a fictional SOC component with 16 implemented statement-level contributions. The [control workspace](docs/control-workspace.md) supports the default System component and user-defined SSP-local components, independent copy/move assignments and native OSCAL statuses. It is not a full NIST baseline or a compliance claim. Original Low and Moderate profiles remain reference sources, not selectable demo profiles. See [demo content](demo/README.md).

## Checks

```sh
npm run check
npm audit --audit-level=moderate
npm run security:scan
terraform -chdir=infrastructure init -backend=false -lockfile=readonly
terraform -chdir=infrastructure validate
```

Prepare the demo content first: OSCAL tests use the real catalogue and profiles. Tests cover object-level authorization, sharing boundaries, immutable revisions, attestation, token verification, malformed input, NIST baseline coverage and inherited Lens import/tailoring/rendering regressions. `npm run build` type-checks and produces the static site plus the Functions entry point.

## Deploy from Azure DevOps

Use the [Azure DevOps deployment and rebuild guide](docs/deployment.md). Main merges and pull requests build and verify; cloud deployment requires manually selecting `deploy: true`. Reviewed Terraform plans use central Azure Storage state. The application job deploys the same verified build artifact through a separately scoped identity.

`config/test.json` keeps the personal test topology. `config/dev.json` prepares the work subscription with private data endpoints, Premium Functions, separate pipeline identities and a private-network deployment agent. Both are selectable in build, infrastructure, deployment and operations pipelines. Templates contain placeholders: the selected environment's protected variable group must hold the complete, matching configuration. Adding the dev file does not deploy anything.

The project includes the application, Terraform, pipelines and a pinned official NIST content preparation/publication path. A separate controlled-content repository is optional; see [content publication](docs/content.md). Demo publication remains separate and is forbidden in dev. See [work-dev setup and acceptance](docs/work-dev.md), [before-production guidance](docs/before-production.md) and [identity and permissions](docs/permissions.md).

- [Architecture assessment and design](docs/architecture.md)
- [API contract](docs/api.md)
- [Security architecture, controls, limits and release evidence](docs/security.md)
- [Demo lifecycle](demo/README.md)
- [Third-party provenance](THIRD_PARTY_NOTICES.md)

## Boundaries

The UI supports the initial SSP workflow; it is not an assessment/compliance certification tool. Schema and referential validation do not prove control effectiveness or satisfy all ODP constraints. All approved content is JSON. Supported schema versions are explicit in `src/shared/validation.ts`; unsupported versions fail publication rather than silently falling back.

Deployment acceptance must verify real Entra sign-in, Cosmos transactional behavior and read/edit/security identities in the target tenant. Local tests cannot prove the deployed Azure trust boundary. See the runbook for the release checklist. The application shell and sign-in assets are public; SSP and controlled-content API responses require validated single-tenant access tokens. No SSP content is built into the static bundle.

App Admin provides a staged OSCAL library and tenant administration. Raw storage exploration and permanent deletion are disabled by default and require explicit configuration as well as the role. Configure its role through the deployment pipeline; see [App Admin and reference handling](docs/app-admin.md).

Previously downloaded SSP JSON files can be restored with **Upload SSP**. See [SSP upload and copy behavior](docs/ssp-upload.md); the UI includes a requirements help dialog.
