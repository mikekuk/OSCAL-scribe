import { writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { prepareReferenceSources } from "./reference-content";

const root = "work/demo-source";
const reference = await prepareReferenceSources(root);
const names = reference.files.map(file => file.path);
const provenance = {
  repository: `https://github.com/${reference.repository}`,
  commit: reference.commit,
  files: [...reference.files] as Array<{path: string; sha256: string; url?: string; source?: string}>,
};
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
