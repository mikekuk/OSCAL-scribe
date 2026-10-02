import { readFile } from "node:fs/promises";
import { cosmos } from "../src/api/cosmos";
import { hash } from "../src/api/service";
import { validate } from "../src/shared/validation";
const release = JSON.parse(
  await readFile(process.argv[2] || "work/content-release.json", "utf8"),
);
if (release.demo && process.env.ALLOW_DEMO_PUBLICATION !== "true")
  throw Error("Set ALLOW_DEMO_PUBLICATION=true for explicit demo publication");
for (const d of [
  ...release.sources.map((s: any) => s.doc),
  ...release.profiles.map((p: any) => p.resolved),
]) {
  const errors = validate(d, 20_000_000);
  if (errors.length) throw Error(errors.join("\n"));
}
if (hash({ ...release, id: "" }).slice(0, 32) !== release.id)
  throw Error("Release digest mismatch");
const container = cosmos()
    .database(process.env.COSMOS_DATABASE || "scribe")
    .container("content"),
  data = Buffer.from(JSON.stringify(release));
let chunks = 0;
// Immutable create, never upsert a release. Re-publishing identical chunks is idempotent after byte verification.
async function createExact(doc: any) {
  try {
    await container.items.create(doc);
  } catch (e: any) {
    if (e.code !== 409) throw e;
    const { resource: old } = await container
      .item(doc.id, doc.releaseId)
      .read();
    for (const key of Object.keys(doc))
      if (JSON.stringify(old?.[key]) !== JSON.stringify(doc[key]))
        throw Error("Immutable release conflict");
  }
}
for (let i = 0; i < data.length; i += 500000) {
  await createExact({
    id: "chunk:" + chunks,
    releaseId: release.id,
    kind: "chunk",
    index: chunks++,
    data: data.subarray(i, i + 500000).toString("base64"),
  });
}
await createExact({
  id: "manifest",
  releaseId: release.id,
  hash: hash(release),
  chunks,
  demo: release.demo,
});
// The approved pointer moves last; a failure above leaves the previous release active.
await container.items.upsert({
  id: "active",
  releaseId: "index",
  target: release.id,
});
console.log("Published approved release " + release.id);
