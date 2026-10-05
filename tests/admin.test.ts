import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Service, ApiError } from "../src/api/service";
import { MemoryRepository } from "../src/api/memory";
import { CosmosRepository } from "../src/api/cosmos";
import { referenceProblems, references, libraryPath, type AdminStore, type Library } from "../src/api/admin";
import type { Json, User } from "../src/shared/types";

class MemoryAdmin implements AdminStore {
  state: Library = { entries: [], version: 0 };
  docs = new Map<string, Json>();
  events: Json[] = [];
  rawCalls = 0;
  async library() { return structuredClone(this.state); }
  async saveLibrary(before: Library, after: Library) {
    if (before.version !== this.state.version) throw new ApiError(409, "Library changed");
    this.state = structuredClone(after);
  }
  async putAsset(id: string, doc: Json) { this.docs.set(id, structuredClone(doc)); }
  async asset(id: string) { return structuredClone(this.docs.get(id)!); }
  async deleteAsset(id: string) { this.docs.delete(id); }
  async raw() { this.rawCalls++; return { items: [] }; }
  async partitions() { return { items: ["library"] }; }
  async audit(event: Json) { this.events.push(event); }
}
const admin: User = { oid: "admin", tid: "tenant", roles: ["AppAdmin"] };
const ordinary: User = { oid: "owner", tid: "tenant", roles: ["User"] };
const metadata = { title: "Test", version: "1", "oscal-version": "1.2.2", "last-modified": "2026-10-05T00:00:00Z" };
const catalog = () => ({ catalog: { uuid: randomUUID(), metadata, controls: [{ id: "ac-1", title: "Access" }] } });
const profile = (href = "catalog.json") => ({ profile: { uuid: randomUUID(), metadata, imports: [{ href, "include-all": {} }] } });
function fixture() {
  const repo = new MemoryRepository(), store = new MemoryAdmin();
  const release: any = { id: "release", demo: false, sources: [], components: [], profiles: [{ id: "profile", title: "Example", resolved: catalog() }] };
  const service = new Service(repo, { active: async () => release, get: async () => release }, store);
  return { repo, store, service };
}
async function denied(p: Promise<any>, status: number) { await assert.rejects(p, (e: any) => e.status === status); }

test("all administration endpoints require AppAdmin, not owner or Security", async () => {
  const { service, store } = fixture();
  for (const user of [ordinary, { ...ordinary, roles: ["Security"] }]) {
    for (const [method, path] of [["GET", "admin/ssps"], ["GET", "admin/library"], ["POST", "admin/raw"], ["GET", "admin/partitions"], ["POST", "admin/library"], ["DELETE", "admin/library/x"], ["DELETE", "admin/ssps/x"]])
      await denied(service.request(user, method, path), 403);
  }
  assert.equal(store.rawCalls, 0);
  assert.equal(store.events.length, 0);
});
test("permanent deletion checks tenant, explicit confirmation and version, then removes all SSP records", async () => {
  const { service, repo, store } = fixture();
  const s = await service.request(ordinary, "POST", "ssps", { releaseId: "release", profileId: "profile", systemName: "Disposable" });
  assert.equal((await service.request(admin, "GET", "ssps")).length, 1);
  await denied(service.request({ ...admin, tid: "other" }, "POST", "admin/raw", { container: "ssps", partition: s.sspId }), 404);
  await denied(service.request({ ...admin, tid: "other" }, "DELETE", "admin/ssps/" + s.sspId, { confirm: s.sspId, version: 1 }), 404);
  await denied(service.request(admin, "DELETE", "admin/ssps/" + s.sspId, { confirm: "wrong", version: 1 }), 409);
  await denied(service.request(admin, "DELETE", "admin/ssps/" + s.sspId, { confirm: s.sspId, version: 0 }), 409);
  await service.request(admin, "DELETE", "admin/ssps/" + s.sspId, { confirm: s.sspId, version: 1 });
  assert.equal(await repo.get(s.sspId), undefined);
  assert.deepEqual(await repo.records(s.sspId, ""), []);
  assert.equal(store.events.at(-1)?.operation, "ssp-deleted");
});
test("library upload validates models, rejects overwrite, resolves references and protects dependencies", async () => {
  const { service, store } = fixture();
  await denied(service.request(admin, "POST", "admin/library", { path: "../bad.json", doc: catalog() }), 400);
  await denied(service.request(admin, "POST", "admin/library", { path: "bad.json", doc: null }), 422);
  const c = catalog();
  const catalogEntry = await service.request(admin, "POST", "admin/library", { path: "catalog.json", doc: c });
  await denied(service.request(admin, "POST", "admin/library", { path: "catalog.json", doc: catalog() }), 409);
  await denied(service.request(admin, "POST", "admin/library", { path: "duplicate.json", doc: c }), 409);
  const p = await service.request(admin, "POST", "admin/library", { path: "profile.json", doc: profile() });
  const exported = await service.request(admin, "GET", "admin/library/export");
  assert.equal(exported.sources.length, 2);
  assert.equal(exported.manifest.profiles[0].path, "profile.json");
  await denied(service.request(admin, "DELETE", "admin/library/" + catalogEntry.id, { confirm: "catalog.json", version: 2 }), 409);
  await denied(service.request(admin, "DELETE", "admin/library/" + p.id, { confirm: "profile.json", version: 1 }), 409);
  await service.request(admin, "DELETE", "admin/library/" + p.id, { confirm: "profile.json", version: 2 });
  await service.request(admin, "DELETE", "admin/library/" + catalogEntry.id, { confirm: "catalog.json", version: 3 });
  assert.equal(store.docs.size, 0);
});
test("missing imports can be staged but block export; remote, resource and circular references are checked", async () => {
  const { service } = fixture();
  await service.request(admin, "POST", "admin/library", { path: "profile.json", doc: profile("missing.json") });
  await denied(service.request(admin, "GET", "admin/library/export"), 422);
  assert.match((await service.request(admin, "GET", "admin/library")).problems[0], /Missing reference/);
  for (const href of ["https://evil.example/catalog.json", "file:///etc/passwd", "../../catalog.json", "%2e%2e/catalog.json", "#missing"])
    assert.throws(() => references(profile(href), "profile.json"));
  assert.deepEqual(references(profile("../catalog.json"), "profiles/p.json"), ["catalog.json"]);
  const fragment = profile("#resource");
  (fragment.profile as any)["back-matter"] = { resources: [{ uuid: "resource", rlinks: [{ href: "catalog.json" }] }] };
  assert.deepEqual(references(fragment, "p.json"), ["catalog.json"]);
  assert.match(referenceProblems([{ path: "a.json", model: "profile", references: ["b.json"] }, { path: "b.json", model: "profile", references: ["a.json"] }] as any).join(), /Circular/);
  assert.throws(() => libraryPath("a//b.json"));
});
test("concurrent library edits fail closed without dropping either dependency check", async () => {
  const { service, store } = fixture();
  const results = await Promise.allSettled(["a.json", "b.json"].map(path => service.request(admin, "POST", "admin/library", { path, doc: catalog() })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(store.state.entries.length, 1);
});
test("raw explorer rejects arbitrary containers and inaccessible SSP partitions", async () => {
  const { service, store } = fixture();
  await denied(service.request(admin, "POST", "admin/raw", { container: "users", partition: "x" }), 400);
  await denied(service.request(admin, "POST", "admin/raw", { container: "ssps", partition: "missing" }), 404);
  await service.request(admin, "POST", "admin/raw", { container: "content", partition: "library" });
  assert.equal(store.rawCalls, 1);
});
test("Cosmos purge freezes writes, supports more than 100 records and retries an interrupted delete", async () => {
  const records = new Map<string, any>([["current", { id: "current", sspId: "s", version: 1, _etag: "old" }]]);
  for (let i = 0; i < 220; i++) records.set("revision:" + i, { id: "revision:" + i });
  let fail = true;
  const batches: any[][] = [];
  const container: any = {
    item: (id: string) => ({ read: async () => ({ resource: records.get(id) }), delete: async (options: any) => { assert.equal(options.accessCondition.condition, "frozen"); records.delete(id); } }),
    items: {
      batch: async (ops: any[]) => {
        batches.push(ops);
        if (ops[0].operationType === "Replace") { assert.equal(ops[0].ifMatch, "old"); records.set("current", { ...ops[0].resourceBody, _etag: "frozen" }); }
        else { if (fail) { fail = false; throw Error("Transient interruption"); } for (const op of ops) records.delete(op.id); }
        return { code: 200 };
      },
      query: () => ({ fetchAll: async () => ({ resources: [...records.values()].filter(r => r.id !== "current").slice(0, 99) }) }),
    },
  };
  const repo = new CosmosRepository(container);
  await assert.rejects(repo.purge(records.get("current")), /Transient/);
  assert.equal(records.get("current").deleting, true);
  assert.equal(records.get("current").version, 2);
  await repo.purge(records.get("current"));
  assert.equal(records.size, 0);
  assert.ok(batches.every(b => b.length <= 99));
  assert.equal(batches.filter(b => b[0].operationType === "Replace").length, 1);
});

test("component-definition imports protect their target and reject the wrong model", async () => {
  const { service } = fixture();
  const base = { "component-definition": { uuid: randomUUID(), metadata } };
  const entry = await service.request(admin, "POST", "admin/library", { path: "base.json", doc: base });
  const dependent = { "component-definition": { uuid: randomUUID(), metadata, "import-component-definitions": [{ href: "base.json" }] } };
  await service.request(admin, "POST", "admin/library", { path: "derived.json", doc: dependent });
  assert.deepEqual((await service.request(admin, "GET", "admin/library")).problems, []);
  await denied(service.request(admin, "DELETE", "admin/library/" + entry.id, { confirm: "base.json", version: 2 }), 409);
  assert.match(referenceProblems([{ path: "c.json", model: "component-definition", references: ["cat.json"], componentImports: ["cat.json"] }, { path: "cat.json", model: "catalog", references: [] }] as any).join(), /wrong document model/);
});
test("library reads reject modified stored content", async () => {
  const { service, store } = fixture();
  const entry = await service.request(admin, "POST", "admin/library", { path: "catalog.json", doc: catalog() });
  store.docs.get(entry.id)!.catalog.metadata.title = "Changed";
  await denied(service.request(admin, "GET", "admin/library/" + entry.id), 503);
});

test("cycle-closing uploads are rejected so staged documents can still be removed", async () => {
  const { service, store } = fixture();
  await service.request(admin, "POST", "admin/library", { path: "a.json", doc: profile("b.json") });
  await denied(service.request(admin, "POST", "admin/library", { path: "b.json", doc: profile("a.json") }), 422);
  assert.equal(store.state.entries.length, 1);
});

test("admin plan pages are bounded, searchable, tenant-scoped and filterable", async () => {
  const { service, repo } = fixture();
  for (let i = 0; i < 63; i++) {
    const plan = await service.request(ordinary, "POST", "ssps", { releaseId: "release", profileId: "profile", systemName: "Plan " + String(i).padStart(3, "0") });
    if (i === 62) repo.current.get(plan.sspId)!.archived = true;
  }
  await service.request({ ...ordinary, tid: "other" }, "POST", "ssps", { releaseId: "release", profileId: "profile", systemName: "Other tenant" });
  const first = await service.request(admin, "POST", "admin/ssps", { state: "all" });
  assert.equal(first.items.length, 25); assert.ok(first.cursor);
  const second = await service.request(admin, "POST", "admin/ssps", { cursor: first.cursor });
  assert.equal(second.items.length, 25);
  const last = await service.request(admin, "POST", "admin/ssps", { cursor: second.cursor });
  assert.equal(last.items.length, 13); assert.equal(last.cursor, undefined);
  assert.equal(new Set([...first.items,...second.items,...last.items].map(s=>s.sspId)).size,63);
  assert.equal((await service.request(admin, "POST", "admin/ssps", { query: "Plan 062" })).items.length,1);
  assert.equal((await service.request(admin, "POST", "admin/ssps", { state: "archived" })).items.length,1);
  assert.equal((await service.request(admin, "POST", "admin/ssps", { query: "Other tenant" })).items.length,0);
  await denied(service.request(admin, "POST", "admin/ssps", { state: "invalid" }),400);
});

test("Cosmos plan search uses bounded pages, parameters and an indexed case-insensitive title", async () => {
  let captured: any;
  const container: any = { items: { query: (spec: any, options: any) => { captured = {spec,options}; return { fetchNext: async () => ({ resources: [], continuationToken: "next" }) }; } } };
  const result = await new CosmosRepository(container).adminPage(admin, 'x" OR true', "archived", "previous");
  assert.equal(captured.options.maxItemCount,25);
  assert.equal(captured.options.continuationToken,"previous");
  assert.equal(captured.spec.parameters.find((p:any)=>p.name==="@tenant").value, admin.tid);
  assert.equal(captured.spec.parameters.find((p:any)=>p.name==="@query").value, 'x" or true');
  assert.doesNotMatch(captured.spec.query, /LOWER|OR true/);
  assert.match(captured.spec.query,/c.archived = true/);
  assert.equal(result.cursor,"next");
});
