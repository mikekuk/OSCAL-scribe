import Ajv from "ajv";
import addFormats from "ajv-formats";
import ssp from "./schemas/1.2.2/oscal_ssp_schema.json";
import catalog from "./schemas/1.2.2/oscal_catalog_schema.json";
import profile from "./schemas/1.2.2/oscal_profile_schema.json";
import component from "./schemas/1.2.2/oscal_component_schema.json";
import mapping from "./schemas/1.2.2/oscal_mapping_schema.json";
import oldCatalog from "./schemas/1.1.3/oscal_catalog_schema.json";
import oldProfile from "./schemas/1.1.3/oscal_profile_schema.json";
import type { Json } from "./types";
const schemas: Record<string, any> = {
  "system-security-plan@1.2.2": ssp,
  "catalog@1.2.2": catalog,
  "profile@1.2.2": profile,
  "component-definition@1.2.2": component,
  "mapping-collection@1.2.2": mapping,
  "catalog@1.1.3": oldCatalog,
  "profile@1.1.3": oldProfile,
};
const validators = new Map<string, any>();
export function bounded(value: unknown, maxBytes = 1_000_000) {
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).length > maxBytes)
    throw Error("Document too large");
  let count = 0;
  const walk = (x: any, d: number) => {
    if (d > 64 || ++count > Math.max(150000, maxBytes / 4))
      throw Error("Document complexity limit");
    if (x && typeof x === "object")
      for (const [k, v] of Object.entries(x)) {
        if (["__proto__", "constructor", "prototype"].includes(k))
          throw Error("Unsafe property");
        walk(v, d + 1);
      }
  };
  walk(value, 0);
}
export function validate(doc: Json, maxBytes = 1_000_000): string[] {
  try {
    bounded(doc, maxBytes);
  } catch (e) {
    return [(e as Error).message];
  }
  const roots = Object.keys(doc).filter((k) => k !== "$schema");
  if (roots.length !== 1) return ["Exactly one OSCAL model is required"];
  const key = roots[0] + "@" + doc[roots[0]]?.metadata?.["oscal-version"];
  if (!schemas[key]) return ["Unsupported OSCAL model/version: " + key];
  if (!validators.has(key)) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    validators.set(key, ajv.compile(schemas[key]));
  }
  const v = validators.get(key);
  v(doc);
  const errors = (v.errors || []).map(
    (e: any) => `${e.instancePath} ${e.message}`,
  );
  const seen = new Set<string>();
  const walk = (x: any) => {
    if (!x || typeof x !== "object") return;
    for (const [k, a] of Object.entries(x)) {
      if (Array.isArray(a))
        for (const y of a) {
          if (
            y &&
            (y.id || y.uuid) &&
            [
              "controls",
              "parts",
              "params",
              "roles",
              "parties",
              "components",
              "implemented-requirements",
              "statements",
              "resources",
            ].includes(k)
          ) {
            const id = k + ":" + (y.id || y.uuid);
            if (seen.has(id)) errors.push("Duplicate identifier " + id);
            seen.add(id);
          }
          walk(y);
        }
      else walk(a);
    }
  };
  walk(doc);
  return errors.slice(0, 100);
}
