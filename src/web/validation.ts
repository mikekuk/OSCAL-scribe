import check from "../shared/generated-ssp.mjs";
import type { Json } from "../shared/types";
// Generated at build time: no runtime eval, compatible with the production CSP.
export function validate(doc: Json): string[] {
  check(doc);
  return (check.errors || []).map((e: any) => `${e.instancePath} ${e.message}`);
}
