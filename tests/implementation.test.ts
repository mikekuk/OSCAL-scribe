import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createSsp, integrity, statementParts } from "../src/shared/oscal";
import { addRole, removeRole, setSectionStatus, progress, effectiveRequirement, removeComponent, requirement, setDescription, applyComponentStatements, sectionStatus, systemComponent, addLocalComponent, transferControls, assignedComponentIds, componentProgress, deleteLocalComponent, deleteControlAssignment } from "../src/shared/implementation";
import { filterControls, renderControlCards } from "../src/web/control-view";
import { flatten } from "../src/shared/lens/engine.mjs";
import { validate } from "../src/shared/validation";

function fixture() {
  const control = { id: "ac-1", title: "Access policy", parts: [{ id: "ac-1_smt", name: "statement", parts: [
    { id: "a", name: "item", prose: "First requirement" }, { id: "b", name: "item", prose: "Second requirement" },
  ] }] };
  const profile: any = { id: "example", resolved: { catalog: { groups: [{ id: "ac", title: "Access Control", controls: [control] }] } } };
  const doc = createSsp("Test", profile, "release"), b = doc["system-security-plan"], req = requirement(b, "ac-1");
  const system = systemComponent(b).uuid;
  const component = { uuid: "11111111-1111-4111-8111-111111111111", type: "service", title: "Shared service", description: "Shared implementation" };
  b["system-implementation"].components.push({ ...component, status: { state: "operational" } });
  const contribution: any = { "control-id": "ac-1", description: "Shared contribution" };
  const definitions = [{ "component-definition": { uuid: "44444444-4444-4444-8444-444444444444", components: [{ ...component, "control-implementations": [{ "implemented-requirements": [contribution] }] }] } }];
  return { doc, b, req, system, control, profile, component, contribution, definitions };
}
function noStatusProps(doc: any) {
  assert.doesNotMatch(JSON.stringify(doc), /"name":"(?:implementation-status|implementation-component|status-tracking|completion-decision)"/);
}
test("SSP-local System tracks all non-inherited statements with native statuses", () => {
  const { doc, b, req, system, control, profile } = fixture();
  assert.equal(systemComponent(b).title, "System");
  assert.equal(req.statements.length, 2);
  assert.equal(progress(req, control, system).status, "planned");
  for (const [a, second, expected] of [["implemented", "partial", "partial"], ["implemented", "alternative", "implemented"], ["not-applicable", "not-applicable", "not-applicable"], ["alternative", "alternative", "alternative"], ["planned", "planned", "planned"]]) {
    setSectionStatus(b, req, control, "a", a, []);
    setSectionStatus(b, req, control, "b", second, []);
    assert.equal(progress(req, control, system).status, expected);
    assert.equal(req.statements[0]["by-components"][0]["component-uuid"], system);
    assert.equal(req.statements[0]["by-components"][0]["implementation-status"].state, a === "planned" ? "planned" : a);
  }
  noStatusProps(doc);
  assert.deepEqual(validate(doc), []);
  assert.deepEqual(integrity(JSON.parse(JSON.stringify(doc)), profile, "release"), []);
  assert.throws(() => removeComponent(b, system, [{ control }]), /cannot be removed/);
});
test("published sections inherit automatically and an entirely inherited parent is green", () => {
  const { b, req, doc, profile, system, control, component, contribution, definitions } = fixture();
  contribution.statements = [{ "statement-id": "a", description: "Full first section" }];
  const before = JSON.stringify(doc), resolved = effectiveRequirement(b, req, control, definitions);
  assert.equal(JSON.stringify(doc), before, "viewing does not mutate the SSP");
  assert.equal(progress(resolved, control, system).complete, 0, "viewing does not reimport published data");
  assert.equal(sectionStatus(resolved.statements[1], system), "planned");
  contribution.statements.push({ "statement-id": "b", description: "Full second section" });
  applyComponentStatements(b, req, control, definitions);
  assert.equal(progress(req, control, system).status, "implemented");
  for (const s of req.statements) {
    assert.equal(sectionStatus(s, system), "implemented");
    assert.equal(s["by-components"].length, 1);
    assert.equal(s["by-components"][0]["component-uuid"], component.uuid);
    assert.equal(s["by-components"][0]["implementation-status"].state, "implemented");
  }
  const saved = JSON.stringify(req);
  applyComponentStatements(b, req, control, definitions);
  assert.equal(JSON.stringify(req), saved, "stable UUIDs and no duplicate contributions");
  const html = renderControlCards(b, flatten(profile.resolved.catalog), definitions, true, new Set());
  assert.match(html, /control-card status-implemented/);
  assert.match(html, /statement-card status-implemented origin-imported/);
  assert.match(html, />Imported<\/span>/);
  assert.doesNotMatch(html, /Inherited/);
  assert.match(html, /value="implemented" selected/);
  assert.doesNotMatch(html, /<option[^>]*value="component:/);
  assert.match(html, /Full first section/);
  noStatusProps(doc);
  assert.deepEqual(validate(doc), []);
  assert.deepEqual(integrity(JSON.parse(JSON.stringify(doc)), profile, "release"), []);
  removeComponent(b, component.uuid, [{ control }], definitions);
  assert.equal(progress(req, control, system).status, "planned");
  assert.ok(req.statements.every((s: any) => s["by-components"].every((c: any) => c["component-uuid"] === system)));
  b["system-implementation"].components.push({ ...component, status: { state: "operational" } });
  applyComponentStatements(b, req, control, definitions);
  assert.equal(progress(req, control, system).status, "implemented", "reselecting restores coverage");
});
test("whole-control claims and unknown statements cannot imply section coverage", () => {
  const { b, req, system, control, contribution, definitions } = fixture();
  applyComponentStatements(b, req, control, definitions);
  assert.equal(progress(req, control, system).complete, 0);
  contribution.statements = [{ "statement-id": "a", description: "Published work" },
    { "statement-id": "outside-profile", description: "Must not be imported" }];
  applyComponentStatements(b, req, control, definitions);
  assert.equal(req.statements.length, 2);
  assert.equal(progress(req, control, system).complete, 1);
  assert.throws(() => setSectionStatus(b, req, control, "b", "component:missing", definitions), /Unknown implementation status/);
  assert.throws(() => setSectionStatus(b, req, control, "missing", "implemented", definitions), /Unknown statement/);
});
test("SSP component status edits and System narratives survive reimport and component removal", () => {
  const { b, req, system, control, component, contribution, definitions, doc } = fixture();
  contribution.statements = [{ "statement-id": "a", description: "Published section" },
    { "statement-id": "b", description: "Complete section" }];
  applyComponentStatements(b, req, control, definitions);
  setSectionStatus(b, req, control, "a", "partial", definitions, component.uuid);
  const s = req.statements[0], id = s.uuid;
  assert.equal(sectionStatus(s, system), "partial");
  setDescription(s, system, "The system completes the remaining work.");
  setSectionStatus(b, req, control, "a", "implemented", definitions);
  applyComponentStatements(b, req, control, definitions);
  assert.equal(progress(req, control, system).status, "partial", "every assigned component must complete its work");
  setSectionStatus(b, req, control, "a", "implemented", definitions, component.uuid);
  applyComponentStatements(b, req, control, definitions);
  assert.equal(sectionStatus(s, system), "implemented", "SSP edits survive reapplication of the published template");
  assert.equal(s.uuid, id);
  assert.equal(s["by-components"].length, 2);
  removeComponent(b, component.uuid, [{ control }], definitions);
  assert.equal(sectionStatus(s, system), "implemented");
  assert.equal(s["by-components"][0].description, "The system completes the remaining work.");
  assert.equal(progress(req, control, system).status, "partial");
  setDescription(s, system, "");
  assert.equal(sectionStatus(s, system), "implemented", "clearing text preserves status");
  noStatusProps(doc);
  assert.deepEqual(validate(doc), []);
});
test("multiple unrelated components combine section coverage and fall back independently", () => {
  const { b, req, system, control, component, contribution, definitions, doc } = fixture();
  contribution.statements = [{ "statement-id": "a", description: "First provider" }];
  const other = structuredClone(definitions[0]["component-definition"].components[0]);
  other.uuid = "33333333-3333-4333-8333-333333333333";
  other.title = "Identity service";
  other["control-implementations"][0]["implemented-requirements"][0].statements = [{ "statement-id": "b", description: "Second provider" }];
  definitions[0]["component-definition"].components.push(other);
  applyComponentStatements(b, req, control, definitions);
  assert.equal(progress(req, control, system).complete, 1, "unselected providers have no effect");
  b["system-implementation"].components.push({ ...component, uuid: other.uuid, title: other.title, status: { state: "operational" } });
  applyComponentStatements(b, req, control, definitions);
  assert.equal(progress(req, control, system).status, "implemented");
  // Overlapping coverage retains two independent sources and survives either removal.
  other["control-implementations"][0]["implemented-requirements"][0].statements.push({ "statement-id": "a", description: "Second provider also covers first section" });
  applyComponentStatements(b, req, control, definitions);
  assert.equal(req.statements[0]["by-components"].length, 2);
  removeComponent(b, component.uuid, [{ control }], definitions);
  assert.equal(progress(req, control, system).status, "implemented");
  removeComponent(b, other.uuid, [{ control }], definitions);
  assert.equal(progress(req, control, system).status, "planned");
  assert.equal(b["system-implementation"].components.length, 1);
  noStatusProps(doc);
  assert.deepEqual(validate(doc), []);
});
test("standard properties remain intact while progress uses native statuses", () => {
  const { b, req, system, control, definitions, doc } = fixture();
  const s = req.statements[0];
  s.props = [{ name: "label", value: "First section" }];
  setSectionStatus(b, req, control, "a", "implemented", definitions);
  applyComponentStatements(b, req, control, definitions);
  assert.equal(sectionStatus(s, system), "implemented");
  assert.deepEqual(s.props, [{ name: "label", value: "First section" }]);
  noStatusProps(doc);
  assert.deepEqual(validate(doc), []);
});
test("all default roles can be removed with reference cleanup and custom roles remain valid", () => {
  const { b, doc, profile, req } = fixture();
  const party = "22222222-2222-4222-8222-222222222222";
  b.metadata.parties = [{ uuid: party, type: "person", name: "Operator" }];
  b.metadata["responsible-parties"] = b.metadata.roles.map((r: any) => ({ "role-id": r.id, "party-uuids": [party] }));
  req["responsible-roles"] = [{ "role-id": "senior-risk-owner" }];
  for (const role of [...b.metadata.roles]) removeRole(b, role.id);
  assert.equal(b.metadata.roles, undefined);
  assert.equal(req["responsible-roles"], undefined);
  assert.equal(b["system-implementation"].users[0]["role-ids"], undefined);
  assert.equal(b.metadata.parties.length, 1);
  assert.deepEqual(validate(doc), []);
  const role = addRole(b, "Custom <security> lead");
  assert.match(role.id, /^role-/);
  assert.throws(() => addRole(b, "custom <security> lead"), /already exists/);
  assert.deepEqual(integrity(doc, profile, "release"), []);
});
test("cards filter by group and search; read-only controls stay disabled", () => {
  const { b, profile, definitions } = fixture();
  const rows = flatten(profile.resolved.catalog) as any[];
  assert.equal(filterControls(rows, "ac", " AC-1 POLICY ").length, 1);
  assert.equal(filterControls(rows, "ir", "policy").length, 0);
  const html = renderControlCards(b, rows, definitions, false, new Set(["ac-1"]));
  assert.match(html, /data-section-status="a"[^>]*disabled/);
  assert.doesNotMatch(html, /data-parameter|control-select/);
  assert.equal(statementParts(rows[0].control).length, 2);
});
test("ID search ignores cross-references and handles padding and resolved parameters", () => {
  const rows = [
    { control: { id: "ir-5", title: "Incident Monitoring", parts: [{ id: "ir-5_smt", name: "statement", prose: "Review {{ insert: param, frequency }}" }] }, groups: [{ id: "ir" }], parameters: { frequency: { values: ["daily"] } } },
    { control: { id: "au-6", title: "Audit Review", links: [{ href: "#ir-5" }], parts: [{ id: "au-6_smt", name: "statement", prose: "Report under [IR-5](#ir-5)." }] }, groups: [{ id: "au" }], parameters: {} },
  ];
  assert.deepEqual(filterControls(rows, "", "IR-5").map(r => r.control.id), ["ir-5"]);
  assert.deepEqual(filterControls(rows, "", "IR-05 daily").map(r => r.control.id), ["ir-5"]);
  assert.equal(filterControls(rows, "au", "IR-5").length, 0);
  assert.equal(filterControls(rows, "", "daily").length, 1);
  assert.equal(filterControls(rows, "", "zzzz").length, 0);
  assert.equal(filterControls(rows, "", "").length, 2);
});
test("worked example assigns all published statements solely to the imported component", async () => {
  const release = JSON.parse(await readFile("work/content-release.json", "utf8"));
  const profile = release.profiles[0], doc = createSsp("Example", profile, release.id), b = doc["system-security-plan"];
  const system = systemComponent(b).uuid, definition = JSON.parse(await readFile("demo/soc.json", "utf8")), component = definition["component-definition"].components[0];
  const definitions = [definition];
  const published = new Set(component["control-implementations"].flatMap((i: any) => i["implemented-requirements"].flatMap((r: any) => r.statements.map((s: any) => {
    assert.equal(s.props, undefined);
    return s["statement-id"];
  }))));
  assert.equal(published.size, 16);
  b["system-implementation"].components.push({ uuid: component.uuid, type: component.type, title: component.title, description: component.description, status: { state: "operational" } });
  const rows = flatten(profile.resolved.catalog) as any[];
  for (const row of rows) {
    const req = requirement(b, row.control.id);
    applyComponentStatements(b, req, row.control, definitions);
    assert.equal(progress(req, row.control, system).status, ["au-6", "ir-5"].includes(row.control.id) ? "implemented" : ["au-12", "ir-6"].includes(row.control.id) ? "planned" : "partial");
    for (const s of req.statements) {
      const imported = published.has(s["statement-id"]);
      assert.equal(s["by-components"].length, 1);
      assert.equal(s["by-components"][0]["component-uuid"], imported ? component.uuid : system);
      assert.equal(s["by-components"][0]["implementation-status"].state, imported ? "implemented" : "planned");
    }
  }
  noStatusProps(doc);
  assert.deepEqual(validate(doc), []);
  assert.deepEqual(integrity(JSON.parse(JSON.stringify(doc)), profile, release.id), []);
});

test("move System controls to Windows, copy to Linux, and complete each independent implementation", () => {
  const { b, req, control, system, definitions, doc, profile } = fixture();
  const windows = addLocalComponent(b, "Windows servers", "software", "Windows workloads");
  const linux = addLocalComponent(b, "Linux servers", "software", "Linux workloads");
  setSectionStatus(b, req, control, "a", "implemented", definitions);
  setDescription(req.statements[0], system, "System starting narrative");
  transferControls(b, [{ control }], [control.id], system, windows.uuid, "move", definitions);
  assert.equal(assignedComponentIds(req).has(system), false);
  assert.equal(assignedComponentIds(req).has(windows.uuid), true);
  transferControls(b, [{ control }], [control.id], windows.uuid, linux.uuid, "copy", definitions);
  assert.equal(assignedComponentIds(req).has(windows.uuid), true);
  assert.equal(assignedComponentIds(req).has(linux.uuid), true);
  const w = req.statements[0]["by-components"].find((c: any) => c["component-uuid"] === windows.uuid);
  const l = req.statements[0]["by-components"].find((c: any) => c["component-uuid"] === linux.uuid);
  assert.notEqual(w.uuid, l.uuid);
  setDescription(req.statements[0], linux.uuid, "Linux-specific narrative");
  assert.equal(w.description, "System starting narrative");
  setSectionStatus(b, req, control, "a", "partial", definitions, linux.uuid);
  assert.equal(w["implementation-status"].state, "implemented");
  assert.equal(sectionStatus(req.statements[0]), "partial");
  setSectionStatus(b, req, control, "b", "implemented", definitions, windows.uuid);
  assert.equal(componentProgress(req, control, windows.uuid).status, "implemented");
  assert.equal(progress(req, control).status, "partial");
  for (const id of ["a", "b"]) setSectionStatus(b, req, control, id, "implemented", definitions, linux.uuid);
  assert.equal(progress(req, control).status, "implemented");
  const roundtrip = JSON.parse(JSON.stringify(doc));
  assert.deepEqual(validate(roundtrip), []);
  assert.deepEqual(integrity(roundtrip, profile, "release"), []);
  const preview = effectiveRequirement(b, req, control, definitions);
  assert.equal(assignedComponentIds(preview).has(system), false, "view/save never restores moved assignments");
  const html = renderControlCards(b, flatten(profile.resolved.catalog), definitions, true, new Set(), new Set(), linux.uuid);
  assert.match(html, /Linux-specific narrative/);
  assert.doesNotMatch(html, /How Windows servers/);
  noStatusProps(doc);
});
test("imported sources can be copied to local components but never moved or overwritten", () => {
  const { b, req, control, component, contribution, definitions, doc } = fixture();
  contribution.statements = [{ "statement-id": "a", uuid: "55555555-5555-4555-8555-555555555555", description: "Published source narrative" }];
  applyComponentStatements(b, req, control, definitions);
  const local = addLocalComponent(b, "Server group", "hardware", "Local group");
  const before = JSON.stringify(doc);
  assert.throws(() => transferControls(b, [{ control }], [control.id], component.uuid, local.uuid, "move", definitions), /Imported originals/);
  assert.equal(JSON.stringify(doc), before);
  transferControls(b, [{ control }], [control.id], component.uuid, local.uuid, "copy", definitions);
  const entries = req.statements[0]["by-components"];
  assert.equal(entries.find((c: any) => c["component-uuid"] === component.uuid).links[0].rel, "imported-from");
  assert.equal(entries.find((c: any) => c["component-uuid"] === local.uuid).links[0].rel, "derived-from");
  const copied = JSON.stringify(doc);
  assert.throws(() => transferControls(b, [{ control }], [control.id], component.uuid, local.uuid, "copy", definitions), /already has/);
  assert.equal(JSON.stringify(doc), copied, "failed copy never overwrites destination work");
  assert.throws(() => transferControls(b, [{ control }], [control.id], local.uuid, component.uuid, "copy", definitions), /local destination/);
  assert.deepEqual(validate(doc), []);
});
test("component metadata and transfer batches are validated before changing work", () => {
  const { b, req, system, control, definitions, doc } = fixture();
  assert.throws(() => addLocalComponent(b, "System", "software", "Duplicate"), /already exists/);
  assert.throws(() => addLocalComponent(b, "", "software", "Empty"), /name/);
  const target = addLocalComponent(b, "Windows", "software", "Servers");
  const before = JSON.stringify(doc);
  assert.throws(() => transferControls(b, [{ control }], [control.id, "missing"], system, target.uuid, "move", definitions), /no implementation/);
  assert.equal(JSON.stringify(doc), before);
  assert.equal(assignedComponentIds(req).has(system), true);
});

test("copy remaps cross-entry references while move retains implementation identity", () => {
  const { b, req, system, control, definitions, doc } = fixture();
  const destination = addLocalComponent(b, "Destination", "software", "Local destination");
  const moved = addLocalComponent(b, "Moved", "software", "Moved implementation");
  const provided = "66666666-6666-4666-8666-666666666666";
  const responsibility = "77777777-7777-4777-8777-777777777777";
  req["by-components"][0].export = { provided: [{ uuid: provided, description: "Provided implementation" }] };
  req.statements[0]["by-components"][0].export = { responsibilities: [{ uuid: responsibility, "provided-uuid": provided, description: "Related responsibility" }] };
  const originalId = req.statements[0]["by-components"][0].uuid;
  transferControls(b, [{ control }], [control.id], system, destination.uuid, "copy", definitions);
  const rootCopy = req["by-components"].find((c: any) => c["component-uuid"] === destination.uuid);
  const statementCopy = req.statements[0]["by-components"].find((c: any) => c["component-uuid"] === destination.uuid);
  assert.notEqual(rootCopy.export.provided[0].uuid, provided);
  assert.equal(statementCopy.export.responsibilities[0]["provided-uuid"], rootCopy.export.provided[0].uuid);
  transferControls(b, [{ control }], [control.id], system, moved.uuid, "move", definitions);
  assert.equal(req.statements[0]["by-components"].find((c: any) => c["component-uuid"] === moved.uuid).uuid, originalId);
  assert.deepEqual(validate(doc), []);
});

test("published statements replace System work and omitted sections remain assigned", () => {
  const { b, req, system, control, contribution, definitions, doc } = fixture();
  setSectionStatus(b, req, control, "a", "implemented", definitions);
  contribution.statements = [{ "statement-id": "a", description: "Published implementation" }];
  applyComponentStatements(b, req, control, definitions);
  assert.ok(req.statements[0]["by-components"].every((c: any) => c["component-uuid"] !== system));
  assert.equal(req.statements[1]["by-components"][0]["component-uuid"], system);
  assert.equal(sectionStatus(req.statements[0]), "implemented");
  contribution.statements.push({ "statement-id": "b", description: "Another published implementation" });
  applyComponentStatements(b, req, control, definitions);
  assert.equal(assignedComponentIds(req).has(system), false);
  assert.equal(assignedComponentIds(effectiveRequirement(b, req, control, definitions)).has(system), false);
  assert.deepEqual(validate(doc), []);
});
test("control assignment deletion allows planned coverage but protects every uniquely assigned section", () => {
  const { b, req, system, control, definitions, doc } = fixture();
  const local = addLocalComponent(b, "Duplicate", "software", "Duplicate implementation");
  transferControls(b, [{ control }], [control.id], system, local.uuid, "copy", definitions);
  const missing = req.statements[1]["by-components"].find((c: any) => c["component-uuid"] === system);
  req.statements[1]["by-components"] = req.statements[1]["by-components"].filter((c: any) => c !== missing);
  const before = JSON.stringify(doc);
  assert.throws(() => deleteControlAssignment(b, req, control, local.uuid, definitions), /not assigned/);
  assert.equal(JSON.stringify(doc), before, "failed removal is atomic");
  req.statements[1]["by-components"].push(missing);
  // Both remaining System implementations are planned; assignment alone protects coverage.
  deleteControlAssignment(b, req, control, local.uuid, definitions);
  assert.equal(assignedComponentIds(req).has(local.uuid), false);
  assert.equal(assignedComponentIds(effectiveRequirement(b, req, control, definitions)).has(local.uuid), false);
  assert.throws(() => deleteControlAssignment(b, req, control, system, definitions), /not assigned/);
  assert.deepEqual(validate(doc), []);
});
test("deleting a local component returns unique work to System without overwriting other components", () => {
  const { b, req, system, control, definitions, doc, profile } = fixture();
  const local = addLocalComponent(b, "Temporary", "software", "Temporary component");
  transferControls(b, [{ control }], [control.id], system, local.uuid, "move", definitions);
  setSectionStatus(b, req, control, "a", "implemented", definitions, local.uuid);
  setDescription(req.statements[0], local.uuid, "Keep this implementation");
  const id = req.statements[0]["by-components"][0].uuid;
  deleteLocalComponent(b, local.uuid, [{ control }], definitions);
  assert.ok(!b["system-implementation"].components.some((c: any) => c.uuid === local.uuid));
  assert.equal(req.statements[0]["by-components"][0]["component-uuid"], system);
  assert.equal(req.statements[0]["by-components"][0].uuid, id);
  assert.equal(req.statements[0]["by-components"][0].description, "Keep this implementation");
  assert.equal(req.statements[0]["by-components"][0]["implementation-status"].state, "implemented");
  assert.deepEqual(validate(doc), []);
  assert.deepEqual(integrity(doc, profile, "release"), []);
});
test("redundant and empty local components delete cleanly; System and imported originals remain protected", () => {
  const { b, req, system, component, control, definitions, doc } = fixture();
  const local = addLocalComponent(b, "Duplicate", "software", "Duplicate");
  transferControls(b, [{ control }], [control.id], system, local.uuid, "copy", definitions);
  deleteLocalComponent(b, local.uuid, [{ control }], definitions);
  assert.ok(req.statements.every((s: any) => s["by-components"].length === 1));
  const empty = addLocalComponent(b, "Empty", "software", "Empty");
  deleteLocalComponent(b, empty.uuid, [{ control }], definitions);
  assert.throws(() => deleteLocalComponent(b, system, [{ control }], definitions), /additional local/);
  assert.throws(() => deleteLocalComponent(b, component.uuid, [{ control }], definitions), /additional local/);
  assert.throws(() => deleteControlAssignment(b, req, control, component.uuid, definitions), /Imported originals/);
  assert.deepEqual(validate(doc), []);
});
