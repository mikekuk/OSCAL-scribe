# Content publication inputs

The repository includes all code required to build and publish OSCAL releases. A second repository is optional.
`pipelines/content.yml` is manual and supports two `contentSource` choices:

- **`nist-reference`** (default): `scripts/prepare-reference.ts` downloads the exact upstream catalogue and original
  Low/Moderate profiles listed in `content/reference.json`, verifies their SHA-256 hashes, and constructs a local source
  manifest. This contains public NIST reference requirements, not fictional SOC implementation narratives. It is not
  automatically published during app deployment. Obtain your organisation's approval before adopting these baselines.
- **`controlled-repository`**: the pipeline checks out the selected Azure Repos `contentRepository` at `contentRef`.
  Use a reviewed immutable tag/commit. That repository must contain `manifest.json` plus its local JSON import closure.
  Existing library exports can be converted with `scripts/import-library-bundle.ts` and reviewed there.

The source manifest has `demo`, `sources`, `profiles` and `provenance`. Each profile has a stable `id` and relative `path`.
The builder validates all documents, rejects import escapes/cycles, runs the pinned OSCAL CLI and computes release digests.
The publisher verifies the digest, creates immutable release chunks and only then moves the active pointer.
The publisher uses the explicitly logged-in Azure CLI identity, not a build-agent managed identity.

For work dev, select `config/dev.json`. The publisher connection is `oscal-scribe-dev-publisher`, and publication runs
on `scribe-dev-agents` to reach private Cosmos. Protect that connection with independent approval checks and authorize
only this pipeline. The pipeline emits the exact content-source commit and release as artifacts before publication.
Concurrent publications need a service-connection exclusive lock; otherwise the last completed publication becomes active.

The separate Demo pipeline remains test-only and creates fictional example content. `allow_demo: false` rejects that
pipeline, but approval of actual requirements is an organisational decision, not something a JSON flag can establish.
Do not relabel fictional content to bypass the policy. Existing releases remain accessible to plans that reference them.

To build references locally without publishing:

```sh
node --import tsx scripts/prepare-reference.ts
OSCAL_CLI="$PWD/work/oscal-cli/bin/oscal-cli" npm run content:build -- work/reference-source
```

Company SSPs, credentials and private content do not belong in this public application repository.
