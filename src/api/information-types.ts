import { randomUUID } from "node:crypto";
import { impactAxes, impactLevels, type InformationType } from "../shared/information-types";
import type { Json, User } from "../shared/types";
import type { AdminStore } from "./admin";
import { ApiError } from "./service";

export async function informationTypeRequest(store: AdminStore, user: User, method: string, path: string[], body: Json, log: (operation: string, target: string) => Promise<void>) {
  const catalog = await store.informationTypes(user.tid);
  if (method === "GET" && path.length === 1) return { entries: catalog.entries, version: catalog.version };
  const create = method === "POST" && path.length === 1;
  if (!create && !(method === "PUT" && path.length === 2)) throw new ApiError(405, "Information type method not allowed");
  if (!Number.isSafeInteger(body.version) || body.version !== catalog.version) throw new ApiError(409, "Information types changed; reload and retry");
  const input = body.entry;
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some(k => !["name", "description", "active", ...impactAxes].includes(k))
    || typeof input.name !== "string" || !input.name.trim() || input.name.length > 120
    || typeof input.description !== "string" || !input.description.trim() || input.description.length > 2000
    || typeof input.active !== "boolean" || impactAxes.some(axis => !impactLevels.includes(input[axis])))
    throw new ApiError(422, "Provide a name (up to 120 characters), description (up to 2,000 characters), availability, and Negligible, Low, Moderate, High or Critical for each CIA level");
  const existing = catalog.entries.find(e => e.id === path[1]);
  if (!create && !existing) throw new ApiError(404, "Information type not found");
  if (create && catalog.entries.length >= 300) throw new ApiError(422, "Information type limit is 300 entries");
  if (catalog.entries.some(e => e.id !== existing?.id && e.name.toLowerCase() === input.name.trim().toLowerCase())) throw new ApiError(409, "An information type with that name already exists");
  const entry: InformationType = { id: existing?.id || randomUUID(), name: input.name.trim(), description: input.description.trim(), active: input.active,
    confidentiality: input.confidentiality, integrity: input.integrity, availability: input.availability };
  const next = { entries: create ? [...catalog.entries, entry] : catalog.entries.map(e => e.id === entry.id ? entry : e), version: catalog.version + 1 };
  if (Buffer.byteLength(JSON.stringify(next)) > 900_000) throw new ApiError(422, "Information type catalogue capacity exceeded (900 KB)");
  await log(create ? "information-type-create-requested" : "information-type-update-requested", entry.id);
  await store.saveInformationTypes(user.tid, catalog, next);
  await log(create ? "information-type-created" : "information-type-updated", entry.id);
  return next;
}
