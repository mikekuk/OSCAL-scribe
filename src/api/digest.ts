import { createHash } from "node:crypto";
import type { Json } from "../shared/types";

// Sort object keys recursively so equivalent documents have the same digest.
export function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export const hash = (doc: Json) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(doc)))
    .digest("hex");
