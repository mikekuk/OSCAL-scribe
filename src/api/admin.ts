import { safePolicy, type SecurityPolicy } from "./security";
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { ApiError, hash } from "./service";
import { validate } from "../shared/validation";
import type { Json, Repository, User } from "../shared/types";

export const MAX_UPLOAD = 20_000_000;
export interface LibraryEntry { id: string; path: string; model: string; title: string; uuid: string; hash: string; bytes: number; references: string[]; componentImports?: string[]; actor: string; at: string }
export interface Library { entries: LibraryEntry[]; version: number; _etag?: string }
export interface AdminStore {
  library(): Promise<Library>;
  saveLibrary(previous: Library, next: Library): Promise<void>;
  putAsset(id: string, doc: Json): Promise<void>;
  asset(id: string): Promise<Json>;
  deleteAsset(id: string): Promise<void>;
  raw(container: "ssps" | "content", partition: string, cursor?: string, query?: string): Promise<{ items: Json[]; cursor?: string }>;
  partitions(query?: string, cursor?: string): Promise<{ items: string[]; cursor?: string }>;
  audit(event: Json): Promise<void>;
}
const models = ["catalog", "profile", "component-definition"];
/** Portable relative paths are the identity used by OSCAL imports. Never fetch URLs. */
export function libraryPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 200 || !/^[A-Za-z0-9_./-]+\.json$/.test(value)
      || (value === "manifest.json" || value.startsWith("/")) || value.split("/").some(p => !p || p === "." || p === ".."))
    throw new ApiError(400, "Use a relative JSON path, for example catalogs/company.json");
  return value;
}
/** Only resolution dependencies are edges: explanatory hyperlinks are not imports.
 * Back-matter resource imports must resolve to one local rlink; embedded/remote
 * resolution is deliberately left to the controlled publication workflow. */
export function references(doc: Json, path: string): string[] {
  const model = models.find(m => doc[m]), root = doc[model!];
  const hrefs: string[] = model === "profile" ? (root.imports || []).map((i: Json) => i.href)
    : model === "component-definition" ? [...(root.components || []), ...(root.capabilities || [])]
      .flatMap((c: Json) => (c["control-implementations"] || []).map((i: Json) => i.source)) : [];
  if (model === "component-definition") hrefs.push(...(root["import-component-definitions"] || []).map((i: Json) => i.href));
  return [...new Set(hrefs.map(href => {
    if (typeof href !== "string") throw new ApiError(422, "Missing import/source reference");
    if (href.startsWith("#")) {
      const resource = root["back-matter"]?.resources?.find((r: Json) => r.uuid === href.slice(1));
      if (!resource || resource.base64 || resource.rlinks?.length !== 1)
        throw new ApiError(422, "Resource imports need exactly one relative rlink");
      href = resource.rlinks[0].href;
    }
    if (!href || /[:?#%\\]/.test(href) || href.startsWith("/"))
      throw new ApiError(422, "Import/source references must be local relative JSON paths");
    const resolved = posix.normalize(posix.join(posix.dirname(path), href));
    return libraryPath(resolved);
  }))];
}
export function componentImports(doc: Json, path: string): string[] {
  const root = doc["component-definition"];
  if (!root) return [];
  const imports = references({ profile: { imports: root["import-component-definitions"] || [], "back-matter": root["back-matter"] } }, path);
  const sources = references({ "component-definition": { ...root, "import-component-definitions": [] } }, path);
  if (imports.some(dep => sources.includes(dep))) throw new ApiError(422, "A component definition cannot also be a control implementation source");
  return imports;
}
export function referenceProblems(entries: LibraryEntry[]): string[] {
  const byPath = new Map(entries.map(e => [e.path, e])), errors = new Set<string>(), done = new Set<string>();
  const visit = (path: string, trail: string[]) => {
    if (trail.includes(path)) { errors.add("Circular reference: " + [...trail, path].join(" → ")); return; }
    if (done.has(path)) return;
    const entry = byPath.get(path);
    if (!entry) { errors.add("Missing reference: " + path); return; }
    for (const dep of entry.references) {
      const target = byPath.get(dep);
      if (target && !(entry.componentImports?.includes(dep) ? ["component-definition"] : ["catalog", "profile"]).includes(target.model)) errors.add(path + " references the wrong document model: " + dep);
      visit(dep, [...trail, path]);
    }
    done.add(path);
  };
  for (const entry of entries) visit(entry.path, []);
  return [...errors];
}
export class AdminService {
  constructor(private repo: Repository, private store: AdminStore, private policy: SecurityPolicy = safePolicy) {}
  private async readAsset(entry: LibraryEntry) {
    const doc = await this.store.asset(entry.id);
    if (hash(doc) !== entry.hash) throw new ApiError(503, "Library document integrity check failed");
    return doc;
  }
  async request(user: User, method: string, p: string[], body: Json) {
    if (!user.roles.includes("AppAdmin")) throw new ApiError(403, "App Admin role required");
    if (method === "DELETE" && !this.policy.permanentDelete) throw new ApiError(403, "Permanent deletion is disabled in this environment");
    const log = (operation: string, target: string) => this.store.audit({ id: "admin-audit:" + randomUUID(), releaseId: "admin-audit", operation, target, actor: user.oid, tenantId: user.tid, at: new Date().toISOString() });
    const query = body.query ?? "", cursor = body.cursor;
    if (typeof query !== "string" || query.length > 200 || (cursor !== undefined && (typeof cursor !== "string" || cursor.length > 16000))) throw new ApiError(400, "Invalid search or page cursor");
    if (p[0] === "ssps" && p.length === 1 && ["GET", "POST"].includes(method)) {
      const state = body.state || "all";
      if (!["all", "active", "archived", "deleting"].includes(state)) throw new ApiError(400, "Invalid plan filter");
      return this.repo.adminPage(user, query, state, cursor);
    }
    if (p[0] === "ssps" && p[1] && method === "DELETE" && p.length === 2) {
      if (!this.policy.permanentDelete) throw new ApiError(403, "Permanent deletion is disabled in this environment");
      const s = await this.repo.get(p[1]);
      if (!s || s.tenantId !== user.tid) throw new ApiError(404, "SSP not found");
      if (body.confirm !== s.sspId || body.version !== s.version) throw new ApiError(409, "Confirm the SSP ID and current version before permanent deletion");
      await log("ssp-delete-requested", s.sspId);
      await this.repo.purge(s);
      await log("ssp-deleted", s.sspId);
      return { deleted: s.sspId };
    }
    if (p[0] === "partitions" && ["GET", "POST"].includes(method) && p.length === 1) {
      if (!this.policy.rawBrowser) throw new ApiError(403, "Raw browsing is disabled in this environment");
      await log("raw-partitions-read", "content");
      return this.store.partitions(query, cursor);
    }
    if (p[0] === "capabilities" && method === "GET") return this.policy;
    if (p[0] === "raw" && method === "POST" && p.length === 1) {
      if (!this.policy.rawBrowser) throw new ApiError(403, "Raw browsing is disabled in this environment");
      if (!["ssps", "content"].includes(body.container) || typeof body.partition !== "string" || body.partition.length > 200
          || (body.cursor !== undefined && (typeof body.cursor !== "string" || body.cursor.length > 16000))) throw new ApiError(400, "Choose a container and partition");
      if (body.container === "ssps") {
        const s = await this.repo.get(body.partition);
        if (!s || s.tenantId !== user.tid) throw new ApiError(404, "SSP not found");
      }
      await log("raw-read", body.container + "/" + body.partition);
      return this.store.raw(body.container, body.partition, body.cursor, query);
    }
    if (p[0] !== "library") throw new ApiError(404, "Admin operation not found");
    const library = await this.store.library();
    if (method === "GET" && p.length === 1) return { ...library, problems: referenceProblems(library.entries) };
    if (p[1] === "export" && method === "GET" && p.length === 2) {
      const problems = referenceProblems(library.entries);
      if (problems.length) throw new ApiError(422, "Resolve library references before export", problems);
      if (!library.entries.some(e => e.model === "profile")) throw new ApiError(422, "Add at least one profile before publication export");
      await log("library-export", "library");
      const sources = [];
      for (const entry of library.entries) sources.push({ path: entry.path, doc: await this.readAsset(entry) });
      // Stable IDs must also meet the existing publisher's profile-ID grammar.
      return { manifest: { demo: false, sources: sources.map(s => s.path), profiles: library.entries.filter(e => e.model === "profile").map(e => ({ id: e.uuid, path: e.path })), provenance: { libraryVersion: library.version, exportedAt: new Date().toISOString(), actor: user.oid } }, sources };
    }
    if (method === "GET" && p.length === 2) {
      const e = library.entries.find(e => e.id === p[1]);
      if (!e) throw new ApiError(404, "Library document not found");
      await log("library-read", e.id);
      return this.readAsset(e);
    }
    if (method === "POST" && p.length === 1) {
      const path = libraryPath(body.path), doc = body.doc;
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new ApiError(422, "Upload an OSCAL JSON object");
      const errors = validate(doc, MAX_UPLOAD);
      if (errors.length) throw new ApiError(422, "Invalid OSCAL document", errors);
      const model = models.find(m => doc[m]);
      if (!model) throw new ApiError(422, "Upload a catalog, profile or component definition");
      if (library.entries.some(e => e.path === path || e.uuid === doc[model].uuid.toLowerCase())) throw new ApiError(409, "Path or OSCAL UUID already exists; use a new version/path or delete the unreferenced document first");
      if (library.entries.length >= 500) throw new ApiError(422, "Library limit is 500 documents");
      const entry: LibraryEntry = { id: randomUUID(), path, model, title: doc[model].metadata.title.slice(0, 300), uuid: doc[model].uuid.toLowerCase(), hash: hash(doc), bytes: Buffer.byteLength(JSON.stringify(doc)), references: references(doc, path), componentImports: componentImports(doc, path), actor: user.oid, at: new Date().toISOString() };
      if (entry.references.length > 1000 || library.entries.reduce((sum, e) => sum + e.bytes, entry.bytes) > 50_000_000 || Buffer.byteLength(JSON.stringify([...library.entries, entry])) > 900_000) throw new ApiError(422, "Library capacity exceeded (50 MB total or reference metadata limit)");
      const cycles = referenceProblems([...library.entries, entry]).filter(p => p.startsWith("Circular reference:"));
      if (cycles.length) throw new ApiError(422, "Circular library imports are not allowed", cycles);
      await log("library-upload-requested", entry.id);
      await this.store.putAsset(entry.id, doc);
      // The shared registry ETag serializes upload and deletion dependency checks.
      // An upload racing another edit may leave unlisted chunks, but never a broken live entry.
      await this.store.saveLibrary(library, { entries: [...library.entries, entry], version: library.version + 1 });
      await log("library-uploaded", entry.id);
      return entry;
    }
    if (method === "DELETE" && p.length === 2) {
      const entry = library.entries.find(e => e.id === p[1]);
      if (!entry) throw new ApiError(404, "Library document not found");
      if (body.confirm !== entry.path || body.version !== library.version) throw new ApiError(409, "Confirm the path and current library version before deletion");
      const dependents = library.entries.filter(e => e.references.includes(entry.path));
      if (dependents.length) throw new ApiError(409, "Document is referenced; remove dependents first", dependents.map(e => e.path));
      await log("library-delete-requested", entry.id);
      await this.store.saveLibrary(library, { entries: library.entries.filter(e => e.id !== entry.id), version: library.version + 1 });
      await this.store.deleteAsset(entry.id);
      await log("library-deleted", entry.id);
      return { deleted: entry.path };
    }
    throw new ApiError(405, "Admin method not allowed");
  }
}
