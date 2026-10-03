# Removable demonstration content

Demo content is opt-in. It is not included in the static site or created automatically in Cosmos.

For cloud deployment, run `pipelines/demo.yml` in Azure DevOps after the application deployment. The environment configuration must set `allow_demo: true`. This pipeline builds and publishes demo data independently; no local files or login are needed. See the [cloud setup guide](../docs/deployment.md#6-add-demo-data-separately).

For optional local development only:

```sh
npm run demo:prepare
OSCAL_CLI="$PWD/work/oscal-cli/bin/oscal-cli" npm run content:build
```

The importer fetches official NIST SP800-53 revision 5.2.0 at commit `78650f02ad9321bb7b817846f8fbd4f2bcd620de`, retaining source URLs/checksums and original unresolved Low/Moderate profiles. Output lives only in ignored `work/demo-source` and `work/content-release.json`. All nested profile imports are staged locally before the resolver runs; the resolver cannot choose an unapproved remote import.

The fictional company SOC is a service component contributing partial/shared implementation to AU-2, AU-6, AU-12, IR-4, IR-5, IR-6 and SI-4. Assumptions: 24/7 triage; daily audit review; centrally ingested logs; coordinated incident tracking/reporting; threat monitoring. Consuming systems still own telemetry onboarding, source configuration, sensor coverage, retention requirements, containment approval and remediation. The SOC never marks controls automatically complete.

To stop offering demo profiles, publish a real approved release without `ALLOW_DEMO_PUBLICATION`. New plans see only the active release. Keep historical demo releases while retained test SSPs reference them. For clean production, use a new Cosmos account/database and import only approved controlled content: no demo SSPs, releases or identities carry across. The entire demo importer and this directory may be removed later without modifying the production API or editor.
