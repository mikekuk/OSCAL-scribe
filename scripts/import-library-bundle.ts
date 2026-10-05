import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { libraryPath, references, componentImports, referenceProblems, type LibraryEntry } from "../src/api/admin";
import { validate } from "../src/shared/validation";
// Exported bundles are reviewed in the controlled-content repository. They are
// never directly published by the browser; the pipeline still runs the pinned CLI.
const bundle = JSON.parse(await readFile(process.argv[2] || "oscal-library-bundle.json", "utf8"));
const destination = resolve(process.argv[3] || "work/library-source");
if (!Array.isArray(bundle.sources) || !bundle.sources.length || bundle.sources.length > 500) throw Error("Invalid library bundle");
const entries: LibraryEntry[] = [];
const seen = new Set<string>(), uuids = new Set<string>();
for (const source of bundle.sources) {
  const path = libraryPath(source.path), doc = source.doc;
  if (seen.has(path)) throw Error("Duplicate path");
  seen.add(path);
  const errors = validate(doc, 20_000_000);
  if (errors.length) throw Error(path + ": " + errors.join("; "));
  const model = ["catalog", "profile", "component-definition"].find(m => doc[m]);
  if (!model) throw Error("Unsupported model");
  const uuid = doc[model].uuid.toLowerCase();
  if (uuids.has(uuid)) throw Error("Duplicate OSCAL UUID");
  uuids.add(uuid);
  entries.push({ path, model, uuid, references: references(doc, path), componentImports: componentImports(doc, path) } as LibraryEntry);
}
const problems = referenceProblems(entries);
if (problems.length) throw Error(problems.join("\n"));
if (!entries.some(e => e.model === "profile")) throw Error("At least one profile is required");
// Fail if the destination exists; never overwrite a controlled repository checkout.
await mkdir(destination);
for (const source of bundle.sources) {
  const target = join(destination, libraryPath(source.path));
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, JSON.stringify(source.doc, null, 2) + "\n", { flag: "wx" });
}
await writeFile(join(destination, "manifest.json"), JSON.stringify({ demo: false, sources: entries.map(e => e.path), profiles: entries.filter(e => e.model === "profile").map(e => ({ id: e.uuid, path: e.path })), provenance: { libraryExport: bundle.manifest?.provenance || {} } }, null, 2) + "\n", { flag: "wx" });
console.log("Validated sources written to " + destination + ". Review and commit them to the controlled-content repository, then run its publication pipeline.");
