# Maintaining OSCAL Scribe

Prefer straightforward functions with descriptive names and one responsibility.
Keep changes small enough to review alongside the behaviour they preserve.

## Where to make a change

| Change | Start here |
| --- | --- |
| Browser navigation, save flow or event wiring | `src/web/main.ts` |
| Request headers, access tokens or API errors in the browser | `src/web/api.ts` |
| Resolved control rows and optional Lens provenance | `src/web/baseline.ts` |
| Shared form-field markup and escaping | `src/web/fields.ts` |
| HTTP authentication and request size limits | `src/api/auth.ts`, `src/api/functions.ts` |
| Who can read, edit, share or attest | `src/api/authz.ts` |
| SSP operations and transaction orchestration | `src/api/service.ts` |
| Cosmos persistence and content loading | `src/api/cosmos.ts` |
| Stable document digests | `src/api/digest.ts` |
| SSP creation, integrity checks and review status | `src/shared/oscal.ts` |
| API/content data shapes | `src/shared/types.ts` |
| Schema validation | `src/shared/validation.ts` |

`Service.request` authenticates and routes requests. Named methods handle content
reads, plan creation, document updates, sharing and attestation. `mutatePlan`
owns the common write sequence: check permission, check the caller's version,
clone the saved plan, apply the operation, add the audit record and commit once.
Keep that sequence centralised when adding operations.

The browser entry point owns the current workspace state. Event bindings are
grouped into people, components, controls and plan actions. The API client reads
the current session and plan through callbacks on each request; capturing a
plan at client creation would send stale `If-Match` versions after saving.

## Rules worth preserving

- Access permissions and OSCAL system roles are separate concepts.
- Every write uses optimistic concurrency; revisions and attestations remain immutable.
- The pinned, resolved catalogue is authoritative. Lens preview supplies optional
  provenance and must not replace the resolved requirements.
- Escape user-provided values when generating HTML. Use `renderField` for ordinary
  bound inputs; explain any deliberate rich-text rendering at its call site.
- Add concrete types at application boundaries. OSCAL JSON stays flexible where
  it must support the schema's nested structures.
- Keep errors and digest helpers independent of the service and storage adapters.
- Explain reasons and invariants in comments, rather than restating each line.

## Verify a change

Use Node 22 or later and Java 21, matching CI. On a fresh checkout:

```sh
npm ci
bash scripts/install-oscal-cli.sh
npm run demo:prepare
OSCAL_CLI="$PWD/work/oscal-cli/bin/oscal-cli" npm run content:build
npm run check
```

The preparation steps download pinned inputs and generate the ignored
`work/content-release.json` used by the NIST integration test. They only need
repeating when those inputs change or the work directory is removed.

`npm run check` runs the application/security tests, Lens regression tests,
TypeScript checks and production builds. `tests/web.test.ts` covers the extracted
browser helpers. For browser-facing changes, also run `npm run demo` and check
the affected screens and save flow. Infrastructure changes have separate
Terraform checks in CI.
