import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "work/demo-source",
  commit = "78650f02ad9321bb7b817846f8fbd4f2bcd620de";
await mkdir(root, { recursive: true });
const names = [
  "NIST_SP-800-53_rev5_catalog.json",
  "NIST_SP-800-53_rev5_LOW-baseline_profile.json",
  "NIST_SP-800-53_rev5_MODERATE-baseline_profile.json",
];
const provenance: any = {
  repository: "https://github.com/usnistgov/oscal-content",
  commit,
  files: [],
};
for (const name of names) {
  const url = `https://raw.githubusercontent.com/usnistgov/oscal-content/${commit}/nist.gov/SP800-53/rev5/json/${name}`,
    r = await fetch(url);
  if (!r.ok) throw Error(`Download failed ${r.status}: ${name}`);
  const data = await r.text();
  JSON.parse(data);
  await writeFile(root + "/" + name, data);
  provenance.files.push({
    path: name,
    url,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
const stableUuid = (id: string) => {
  const s = createHash("sha256")
    .update("scribe-demo-soc:" + id)
    .digest("hex");
  return (
    s.slice(0, 8) +
    "-" +
    s.slice(8, 12) +
    "-4" +
    s.slice(13, 16) +
    "-8" +
    s.slice(17, 20) +
    "-" +
    s.slice(20, 32)
  );
};
const descriptions: Record<string, string> = {
  "au-2":
    "SOC advises on event selection. System owners enable and maintain required telemetry.",
  "au-6":
    "SOC reviews centralized audit records daily and triages alerts continuously. Systems must onboard logs and resolve assigned findings.",
  "au-12":
    "SOC supplies ingestion standards and the central logging service. System teams configure sources and verify delivery.",
  "ir-4":
    "SOC provides 24/7 incident triage, investigation and coordination. System owners approve containment and restore services.",
  "ir-5": "SOC tracks security incidents and coordinates status reporting.",
  "ir-6":
    "SOC provides reporting channels and escalates incidents under the company incident procedure.",
  "si-4":
    "SOC monitors onboarded telemetry for threats and suspicious activity. System teams maintain sensor coverage and take remediation actions.",
};
const metadata = {
  title: "Fictional Company SOC — DEMO ONLY",
  version: "1.0.0",
  "oscal-version": "1.2.2",
  "last-modified": "2026-10-02T00:00:00Z",
};
const component = {
  "component-definition": {
    uuid: "619ea8ee-ea92-4e27-b96b-db1382293c84",
    metadata,
    components: [
      {
        uuid: "918e0c1b-f33b-497b-a839-d0f86cbef17f",
        type: "service",
        title: "Company Security Operations Centre (demo)",
        description:
          "Fictional shared SOC: 24/7 security monitoring, centralized log analysis and incident coordination. Partial/shared implementation only; no certification or assurance claim.",
        "control-implementations": [
          {
            uuid: "9a461b25-b2e3-4707-8fa9-b899e35955b5",
            source: "NIST_SP-800-53_rev5_catalog.json",
            description:
              "Assumed service contribution; each consuming system must document onboarding, scope, retention, escalation and its remaining responsibilities.",
            "implemented-requirements": Object.entries(descriptions).map(
              ([id, description]) => ({
                uuid: stableUuid(id),
                "control-id": id,
                description,
              }),
            ),
          },
        ],
      },
    ],
  },
};
await writeFile(root + "/soc.json", JSON.stringify(component, null, 2));
await writeFile(
  root + "/manifest.json",
  JSON.stringify(
    {
      demo: true,
      sources: [...names, "soc.json"],
      profiles: [
        { id: "nist-low", path: names[1] },
        { id: "nist-moderate", path: names[2] },
      ],
      provenance,
    },
    null,
    2,
  ),
);
console.log("Demo sources prepared separately in " + root);
