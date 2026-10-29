// Preparing pinned public references does not publish or approve them.
import { writeFile } from "node:fs/promises";
import { prepareReferenceSources } from "./reference-content";

const root = "work/reference-source";
const config = await prepareReferenceSources(root);
await writeFile(root + "/manifest.json", JSON.stringify({
  demo: false,
  sources: config.files.map(file => file.path),
  profiles: config.profiles,
  provenance: config,
}, null, 2));
console.log("Pinned NIST reference sources prepared; publication is a separate approval decision.");
