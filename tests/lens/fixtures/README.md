# NIST test fixtures

Retrieved from https://github.com/usnistgov/oscal-content on 2026-09-08.

- `nist-low-profile.json`: NIST Rev. 5 LOW baseline profile (OSCAL 1.2.2), with its original XML/JSON/YAML resource link order and 149 selected identifiers.
- `nist-catalog-structure.json`: structural projection of `nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json`, blob `8ebe3c91181cc078d40e39bcf34ea233e652d025`. Retains group/control IDs, titles and hierarchy for deterministic import and selection tests. It is not a full OSCAL catalogue or a schema-validation fixture.

The full 10 MB source catalogue was also used for the initial integration check: 149 selected controls across 18 groups. The compact fixture keeps automated tests small and offline.

- `nist-si-3.json`: full SI-3 control from the same NIST catalogue blob, used to verify nested ODP prompts, statement labels and assessment visibility.

- `nist-ac-1-aggregate.json`: AC-1 parameters and statement from the same NIST catalogue blob, used to verify RMF aggregate parameter references with profile ODP overrides.
