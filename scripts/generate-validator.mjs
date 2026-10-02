import Ajv from "ajv";
import addFormats from "ajv-formats";
import standalone from "ajv/dist/standalone/index.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { build } from "esbuild";
const ajv = new Ajv({ allErrors: true, strict: false, code: { source: true } });
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(
    readFileSync("src/shared/schemas/1.2.2/oscal_ssp_schema.json", "utf8"),
  ),
);
mkdirSync("work", { recursive: true });
writeFileSync("work/ssp-validator.cjs", standalone(ajv, validate));
await build({
  entryPoints: ["work/ssp-validator.cjs"],
  bundle: true,
  platform: "browser",
  format: "esm",
  outfile: "src/shared/generated-ssp.mjs",
});
