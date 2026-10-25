import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Service } from "../src/api/service";
import { MemoryRepository } from "../src/api/memory";
import { MemoryAdminStore } from "../src/api/memory-admin";
import { CosmosAdminStore } from "../src/api/cosmos-admin";
import { createSsp } from "../src/shared/oscal";
import { validate } from "../src/shared/validation";
import { applyInformationSelection, belowMaximumWarnings, catalogId, defaultInformationType, impactAxes, isObjectiveOverride, maximumImpacts, selectedInformationTypes, setObjectiveMode, toOscalInformationType } from "../src/shared/information-types";
import { informationTypesView, bindInformationTypes } from "../src/web/information-types-view";
import type { Json, User } from "../src/shared/types";

const admin: User = { oid: "admin", tid: "tenant", roles: ["AppAdmin"] };
const user: User = { oid: "author", tid: "tenant", roles: ["User"] };
const profile = { id: "baseline", title: "Baseline", resolved: { catalog: { uuid: randomUUID(), metadata: { title: "Baseline", version: "1", "oscal-version": "1.2.2", "last-modified": "2026-10-25T10:00:00Z" }, controls: [{ id: "ac-1", title: "Access" }] } } } as any;
const release = { id: "release", profiles: [profile], components: [], sources: [], demo: true } as any;
const entry = { name: "Personal records", description: "Personnel and contact details", active: true, confidentiality: "high", integrity: "moderate", availability: "low" };
function fixture() {
  const repo = new MemoryRepository(), store = new MemoryAdminStore(repo, release);
  return { repo, store, service: new Service(repo, { active: async () => release, get: async () => release }, store) };
}
const characteristics = () => createSsp("System", profile, "release")["system-security-plan"]["system-characteristics"];
const type = (overrides: Json = {}) => toOscalInformationType({ ...defaultInformationType, ...overrides });
const denied = (promise: Promise<unknown>, status: number) => assert.rejects(promise, (e: any) => e.status === status);

test("catalogue is tenant scoped, authenticated, admin editable, validated and concurrency protected", async () => {
  const { service, store } = fixture();
  await denied(service.request(undefined, "GET", "information-types"), 401);
  await denied(service.request({ ...user, roles: [] }, "GET", "information-types"), 403);
  for (const role of ["User", "Security"]) {
    await denied(service.request({ ...user, roles: [role] }, "POST", "admin/information-types", { version: 0, entry }), 403);
    await denied(service.request({ ...user, roles: [role] }, "PUT", "admin/information-types/id", { version: 0, entry }), 403);
  }
  assert.equal((await service.request(user, "GET", "information-types")).entries.length, 1);
  const created = await service.request(admin, "POST", "admin/information-types", { version: 0, entry });
  const id = created.entries[1].id;
  assert.equal(created.version, 1);
  await denied(service.request(admin, "POST", "admin/information-types", { version: 0, entry }), 409);
  await denied(service.request(admin, "POST", "admin/information-types", { version: 1, entry }), 409);
  for (const invalid of [{ ...entry, confidentiality: "unsupported" }, { ...entry, name: " " }, { ...entry, description: "x".repeat(2001) }, { ...entry, active: "yes" }, { ...entry, id: "injected" }])
    await denied(service.request(admin, "POST", "admin/information-types", { version: 1, entry: invalid }), 422);
  const updated = await service.request(admin, "PUT", "admin/information-types/" + id, { version: 1, entry: { ...entry, name: "HR records", availability: "high", active: false } });
  assert.equal(updated.entries[1].id, id);
  assert.equal(updated.entries[1].availability, "high");
  assert.equal(updated.entries[1].active, false);
  assert.equal((await service.request({ ...user, tid: "other" }, "GET", "information-types")).entries.length, 1);
  const concurrent = await Promise.allSettled(["A", "B"].map(name => service.request(admin, "POST", "admin/information-types", { version: 2, entry: { ...entry, name } })));
  assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(store.events.at(-1)?.tenantId, "tenant");
});

test("selection computes independent maxima and preserves explicit overrides across serialization", () => {
  const c = characteristics();
  applyInformationSelection(c, [type({ confidentiality: "high", integrity: "low", availability: "moderate" }), type({ confidentiality: "low", integrity: "moderate", availability: "high" })]);
  assert.deepEqual(maximumImpacts(selectedInformationTypes(c)), { confidentiality: "high", integrity: "moderate", availability: "high" });
  assert.equal(c["security-impact-level"]["security-objective-confidentiality"], "high");
  c["security-impact-level"]["security-objective-integrity"] = "low";
  setObjectiveMode(c, "integrity", true);
  const reloaded = JSON.parse(JSON.stringify(c));
  applyInformationSelection(reloaded, [type({ confidentiality: "moderate", integrity: "high" })]);
  assert.equal(reloaded["security-impact-level"]["security-objective-integrity"], "low");
  assert.equal(reloaded["security-impact-level"]["security-objective-confidentiality"], "moderate");
  assert.equal(reloaded["security-impact-level"]["security-objective-availability"], "low");
  assert.match(belowMaximumWarnings(reloaded).join(), /Integrity: low.*high.*Business information/);
  assert.equal(belowMaximumWarnings(reloaded).length, 1);
  assert.throws(() => applyInformationSelection(c, []), /at least one/);
});

test("imported values, descriptions and effective selected impacts survive changes", () => {
  const c = characteristics(), imported = { title: "Imported", description: "Keep my details", "confidentiality-impact": { base: "low", selected: "high" }, "integrity-impact": { base: "moderate" }, "availability-impact": { base: "low" } };
  applyInformationSelection(c, [imported]);
  assert.equal(maximumImpacts([imported]).confidentiality, "high");
  c["security-impact-level"]["security-objective-confidentiality"] = "low";
  delete c.props;
  assert.equal(isObjectiveOverride(c, "confidentiality"), true);
  applyInformationSelection(c, [...selectedInformationTypes(c), type()]);
  assert.deepEqual(selectedInformationTypes(c)[0], imported);
  assert.equal(c["security-impact-level"]["security-objective-confidentiality"], "low");
  assert.equal(maximumImpacts([{ title: "Unspecified" }]).confidentiality, undefined);
});

test("new plans use current catalogue levels and saved snapshots/data flows remain schema valid and immutable", async () => {
  const { service } = fixture();
  const catalog = await service.request(admin, "GET", "admin/information-types");
  await service.request(admin, "PUT", "admin/information-types/" + catalog.entries[0].id, { version: 0, entry });
  const plan = await service.request(user, "POST", "ssps", { systemName: "Test", releaseId: "release", profileId: "baseline" });
  const c = plan.oscal["system-security-plan"]["system-characteristics"];
  assert.equal(c["security-impact-level"]["security-objective-confidentiality"], "high");
  assert.equal(selectedInformationTypes(c)[0].title, entry.name);
  assert.equal(catalogId(selectedInformationTypes(c)[0]), catalog.entries[0].id);
  c["data-flow"] = { description: "Clients send records over HTTPS to the service and its internal datastore." };
  c["security-impact-level"]["security-objective-integrity"] = "low";
  setObjectiveMode(c, "integrity", true);
  assert.deepEqual(validate(plan.oscal), []);
  await service.request(user, "PUT", "ssps/" + plan.sspId, { oscal: plan.oscal }, String(plan.version));
  await service.request(admin, "PUT", "admin/information-types/" + catalog.entries[0].id, { version: 1, entry: { ...entry, name: "Changed", confidentiality: "low" } });
  const saved = await service.request(user, "GET", "ssps/" + plan.sspId);
  assert.deepEqual(saved.oscal["system-security-plan"]["system-characteristics"], c);
});

test("Cosmos catalogue persistence uses tenant partitions and ETag conditional writes", async () => {
  const calls: any[] = [];
  let conflict = false;
  const store = new CosmosAdminStore({ container: (name: string) => ({ item: (id: string, partition: string) => ({
    read: async () => { calls.push([name, id, partition]); return { resource: { entries: [], version: 4, _etag: "etag" } }; },
    replace: async (body: any, options: any) => { calls.push([body, options]); if (conflict) throw { code: 412 }; },
  }), items: { create: async (body: any) => { calls.push(body); } } }) } as any);
  const before = await store.informationTypes("tenant");
  await store.saveInformationTypes("tenant", before, { entries: [], version: 5 });
  assert.deepEqual(calls[0], ["staging", "registry", "information-types:tenant"]);
  assert.equal(calls[1][0].releaseId, "information-types:tenant");
  assert.deepEqual(calls[1][1], { accessCondition: { type: "IfMatch", condition: "etag" } });
  conflict = true;
  await denied(store.saveInformationTypes("tenant", before, { entries: [], version: 5 }), 409);
  await store.saveInformationTypes("other", { entries: [], version: 0 }, { entries: [], version: 1 });
  assert.equal(calls.at(-1).releaseId, "information-types:other");
});

test("rendering escapes catalogue content and provides checkboxes, three axes, plots, tooltips and read-only controls", () => {
  const c = characteristics();
  applyInformationSelection(c, [type({ name: '<img src=x onerror="bad()">', description: "<script>bad()</script>" }), type({ id: randomUUID(), name: "Second", confidentiality: "high" })]);
  const html = informationTypesView(c, { entries: [], version: 0 }, false);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.match(html, /&lt;img/);
  assert.equal((html.match(/data-information-type=/g) || []).length, 2);
  assert.equal((html.match(/class="radar-plot"/g) || []).length, 2);
  for (const axis of ["C", "I", "A"]) assert.ok(html.includes(`>${axis}</text>`));
  assert.match(html, /information-tooltip/);
  assert.match(html, /<details class="information-picker"[^>]*><summary>2 information types selected/);
  assert.match(informationTypesView(c, { entries: [], version: 0 }, true, true), /data-expand-key="information-type-picker" open/);
  assert.match(html, /data-objective="confidentiality" disabled/);
});

test("objective and selection warnings support confirm/cancel without mutating the plan on cancel", () => {
  const c = characteristics(); applyInformationSelection(c, [type({ confidentiality: "high" })]);
  const input: any = { dataset: { objective: "confidentiality" }, value: "low" };
  const checkbox: any = { dataset: { informationType: "new" }, checked: true };
  const reset: any = { dataset: { objectiveReset: "confidentiality" } };
  const originals = { document: globalThis.document, confirm: globalThis.confirm };
  let allow = false, prompt = "", changes = 0;
  Object.assign(globalThis, { document: { querySelector: () => null, querySelectorAll: (selector: string) => selector === "[data-objective]" ? [input] : selector === "[data-information-type]" ? [checkbox] : [reset] }, confirm: (message: string) => { prompt = message; return allow; } });
  try {
    bindInformationTypes(c, { entries: [{ ...defaultInformationType, id: "new", name: "New type", confidentiality: "high" }], version: 0 }, true, () => { changes++; });
    const before = structuredClone(c);
    input.onchange(); assert.deepEqual(c, before); assert.equal(input.value, "high"); assert.match(prompt, /Confidentiality: low.*high/);
    allow = true; input.value = "low"; input.onchange(); assert.equal(changes, 1); assert.equal(isObjectiveOverride(c, "confidentiality"), true);
    allow = false; checkbox.onchange(); assert.equal(checkbox.checked, false); assert.equal(selectedInformationTypes(c).length, 1);
    allow = true; checkbox.checked = true; checkbox.onchange(); assert.equal(selectedInformationTypes(c).length, 2); assert.equal(changes, 2);
    reset.onclick(); assert.equal(c["security-impact-level"]["security-objective-confidentiality"], "high"); assert.equal(isObjectiveOverride(c, "confidentiality"), false);
  } finally { Object.assign(globalThis, originals); }
});

test("retired types are excluded from new choices but retained in saved plans; no active types blocks new plans", async () => {
  const { service } = fixture();
  const catalog = await service.request(admin, "GET", "admin/information-types");
  const retired = await service.request(admin, "PUT", "admin/information-types/" + catalog.entries[0].id, { version: 0, entry: { ...entry, active: false } });
  const c = characteristics();
  const html = informationTypesView(c, retired, true);
  assert.match(html, /Retired — saved selection/);
  assert.match(html, /checked/);
  assert.equal((informationTypesView({ "system-information": { "information-types": [] } }, retired, true).match(/data-information-type=/g) || []).length, 0);
  await denied(service.request(user, "POST", "ssps", { systemName: "Test", releaseId: "release", profileId: "baseline" }), 422);
});

test("catalogue storage is byte bounded for multibyte descriptions", async () => {
  const { service, store } = fixture();
  const entries = Array.from({ length: 250 }, (_, i) => ({ ...defaultInformationType, id: randomUUID(), name: "Existing " + i, description: "界".repeat(1500) }));
  store.catalogs.set("tenant", { entries, version: 1 });
  await denied(service.request(admin, "POST", "admin/information-types", { version: 1, entry }), 422);
  assert.equal((await store.informationTypes("tenant")).version, 1);
});

test("five-level scale orders Negligible below Low and Critical above High on every CIA axis", () => {
  const c = characteristics();
  applyInformationSelection(c, [type({ confidentiality: "negligible", integrity: "negligible", availability: "negligible" })]);
  for (const axis of impactAxes) assert.equal(c["security-impact-level"]["security-objective-" + axis], "negligible");
  applyInformationSelection(c, [type({ name: "Critical records", confidentiality: "critical", integrity: "critical", availability: "critical" }), type()]);
  for (const axis of impactAxes) assert.equal(c["security-impact-level"]["security-objective-" + axis], "critical");
  for (const axis of impactAxes) {
    c["security-impact-level"]["security-objective-" + axis] = "high";
    setObjectiveMode(c, axis, true);
  }
  const warnings = belowMaximumWarnings(c);
  assert.equal(warnings.length, 3);
  assert.ok(warnings.every(warning => warning.includes("high is below the selected maximum of critical (Critical records)")));
  const html = informationTypesView(c, { entries: [], version: 0 }, true);
  assert.equal((html.match(/<polygon[^>]+class="radar-grid"/g) || []).length, 5);
  assert.match(html, /Negligible → Low → Moderate → High → Critical/);
  assert.match(html, /organisation-defined extensions/);
  const doc = createSsp("Five levels", profile, "release");
  doc["system-security-plan"]["system-characteristics"] = c;
  assert.deepEqual(validate(doc), []);
});

test("admin accepts and persists both extension levels, and new plans use them without downgrading", async () => {
  const { service } = fixture();
  const catalog = await service.request(admin, "GET", "admin/information-types");
  const edited = await service.request(admin, "PUT", "admin/information-types/" + catalog.entries[0].id, { version: 0, entry: { ...entry, confidentiality: "critical", integrity: "negligible", availability: "critical" } });
  assert.equal(edited.entries[0].confidentiality, "critical");
  assert.equal(edited.entries[0].integrity, "negligible");
  const plan = await service.request(user, "POST", "ssps", { systemName: "Five levels", releaseId: "release", profileId: "baseline" });
  const c = plan.oscal["system-security-plan"]["system-characteristics"];
  assert.deepEqual(maximumImpacts(selectedInformationTypes(c)), { confidentiality: "critical", integrity: "negligible", availability: "critical" });
  assert.equal(c["security-impact-level"]["security-objective-confidentiality"], "critical");
  assert.equal(c["security-impact-level"]["security-objective-integrity"], "negligible");
  assert.deepEqual(validate(plan.oscal), []);
});
