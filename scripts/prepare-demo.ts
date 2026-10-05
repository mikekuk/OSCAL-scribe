import { mkdir, writeFile, readFile } from "node:fs/promises";
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
// Keep the example profile and implementation narratives reviewable in source control.
const examples = ["soc-example-profile.json", "soc.json"];
for (const name of examples) {
  const data = await readFile("demo/" + name, "utf8");
  JSON.parse(data);
  await writeFile(root + "/" + name, data);
  provenance.files.push({
    path: name,
    source: "demo/" + name,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
await writeFile(
  root + "/manifest.json",
  JSON.stringify(
    {
      demo: true,
      sources: [...names, ...examples],
      profiles: [
        { id: "soc-worked-example", path: "soc-example-profile.json" },
      ],
      provenance,
    },
    null,
    2,
  ),
);
console.log("Demo sources prepared separately in " + root);
