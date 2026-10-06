import type { Json } from "./types";
/** Copies keep component/party identities and narratives; only the document UUID
 * changes. Local links to that root follow the copy, while source lineage remains. */
export function copyUploadedSsp(doc: Json, id: string, now: string): Json {
  const copy = structuredClone(doc), body = copy["system-security-plan"], source = body.uuid;
  function links(value: any) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "href" && child === "#" + source) value[key] = "#" + id;
      else if (typeof child === "object") links(child);
    }
  }
  links(copy);
  body.uuid = id;
  body.metadata.version = "1";
  body.metadata["last-modified"] = now;
  body.metadata.links ??= [];
  body.metadata.links.push({ href: "urn:uuid:" + source, rel: "derived-from", text: "Imported SSP source" });
  return copy;
}
