# Removable demonstration content

Demo content is opt-in. Run **Scribe – Demo content** from **main** in Azure DevOps after deploying the application. The Library configuration must set `allow_demo: true`. The pipeline builds and publishes this data independently of application deployment.

## What the pipeline publishes

One selectable profile, **Company SOC worked example — 7 controls — DEMO ONLY**, contains AU-2, AU-6, AU-12, IR-4, IR-5, IR-6 and SI-4. It selects base controls only, without enhancements. It is a fictional training example, not the NIST Low or Moderate baseline and not a complete security requirement set.

- [soc-example-profile.json](soc-example-profile.json) assigns all 18 parameters present in these controls, including the AU-2 aggregate parameter. Examples include daily audit review, quarterly logging reviews and reporting suspected incidents within one hour. These are fictional company choices, not NIST-prescribed values.
- Five clearly titled **Demo context** sections are added inside existing statements: AU-2(c), AU-6(a), IR-4(a), IR-6(a) and SI-4(g). They explain logging scope, review evidence, containment decisions, reporting routes and monitoring boundaries. The source NIST statements remain intact.
- [soc.json](soc.json) provides a fictional shared SOC component. Each selected control has an implementation narrative describing the service's actions, illustrative evidence and the system owner's remaining responsibilities. Contributions are partial/shared; the data does not automatically mark controls complete or supply actual evidence.

## View the example

After successful publication, create a new SSP and select the seven-control profile. Open **Controls / Implementation** to see the assigned ODPs and added statement context. Under **Components**, select the Company Security Operations Centre and expand **Published control contributions** to read its control-by-control implementation text. Record system-specific use and remaining work separately.

Publication makes the new release active for new SSPs. Existing SSPs remain pinned to their original release; publishing this example does not rewrite their profiles or implementation text.

## Source and resolution

The importer fetches official NIST SP800-53 revision 5.2.0 at commit `78650f02ad9321bb7b817846f8fbd4f2bcd620de`, retaining source URLs/checksums. The original Low and Moderate profiles remain unmodified reference sources in the release; they are not offered as demo profile choices. Cross-references to controls outside the seven-control example remain in the NIST text and can be read in the full source catalog.

The custom profile and SOC component are copied from this directory into ignored `work/demo-source`. Their checksums are recorded alongside upstream provenance. The pinned OSCAL CLI resolves the example and validates the release before publication. All imports are staged locally on the hosted agent; the resolver cannot choose an unapproved remote import.

For optional local development only:

```sh
npm run demo:prepare
OSCAL_CLI="$PWD/work/oscal-cli/bin/oscal-cli" npm run content:build
```

## Remove demo choices

Publish a real approved release through **Scribe – Controlled content**. New plans then use the active approved release. Keep historical demo releases while retained test SSPs reference them. For clean production, use a separate environment with `allow_demo: false` and publish only approved content. The demo importer and this directory can be removed without changing the production API or editor; also remove demo preparation and fixture-dependent tests from verification pipelines if retiring demo tooling entirely.

See the [cloud setup guide](../docs/deployment.md#6-add-demo-data-separately).
