import { test } from "node:test";
import assert from "node:assert/strict";
import { createSsp, integrity, statementParts } from "../src/shared/oscal";
import { addRole, removeRole, setSectionStatus, progress, setProp, syncProgress, effectiveRequirement, removeComponent, requirement, setDescription, NS } from "../src/shared/implementation";
import { filterControls, renderControlCards } from "../src/web/control-view";
import { flatten } from "../src/shared/lens/engine.mjs";
import { validate } from "../src/shared/validation";

function fixture() {
  const control = { id: "ac-1", title: "Access policy", parts: [{ id: "ac-1_smt", name: "statement", parts: [
    { id: "a", name: "item", prose: "First requirement" }, { id: "b", name: "item", prose: "Second requirement" },
  ] }] };
  const profile: any = { id: "example", resolved: { catalog: { groups: [{ id: "ac", title: "Access Control", controls: [control] }] } } };
  const doc = createSsp("Test", profile, "release");
  const b = doc["system-security-plan"], req = requirement(b, "ac-1");
  const component = { uuid: "11111111-1111-4111-8111-111111111111", type: "service", title: "SOC", description: "Shared monitoring" };
  b["system-implementation"].components.push({ ...component, status: { state: "operational" } });
  const contribution: any = { "control-id": "ac-1", description: "Shared contribution", props: [{ name: "implementation-status", ns: NS, value: "partial" }] };
  const definitions = [{ "component-definition": { components: [{ ...component, "control-implementations": [{ "implemented-requirements": [contribution] }] }] } }];
  return { doc, b, req, control, profile, component, contribution, definitions };
}
test("section statuses roll up and survive a valid OSCAL round trip", () => {
  const { doc, b, req, control, profile } = fixture();
  assert.equal(progress(req, control).status, "not-set");
  setSectionStatus(b, req, control, "a", "implemented", []);
  assert.equal(progress(req, control).status, "partial");
  setSectionStatus(b, req, control, "b", "alternative", []);
  assert.equal(progress(req, control).status, "implemented");
  setSectionStatus(b, req, control, "a", "not-applicable", []);
  setSectionStatus(b, req, control, "b", "not-applicable", []);
  assert.equal(progress(req, control).status, "not-applicable");
  setSectionStatus(b, req, control, "a", "alternative", []);
  setSectionStatus(b, req, control, "b", "alternative", []);
  assert.equal(progress(req, control).status, "alternative");
  assert.deepEqual(validate(doc), []);
  assert.deepEqual(integrity(JSON.parse(JSON.stringify(doc)), profile, "release"), []);
  setSectionStatus(b, req, control, "a", "not-set", []);
  assert.equal(progress(req, control).status, "partial");
  setSectionStatus(b, req, control, "b", "not-set", []);
  assert.equal(progress(req, control).status, "not-set");
});
test("partial components do not mark sections complete; specific full sections are blue", () => {
  const { b, req, control, component, contribution, definitions } = fixture();
  contribution.statements = [{ "statement-id": "a", description: "Full first section", props: [{ name: "implementation-status", value: "implemented" }] }];
  let resolved = effectiveRequirement(b, req, control, definitions);
  assert.equal(progress(resolved, control).status, "partial");
  assert.equal(progress(resolved, control).complete, 1);
  assert.equal(req.statements, undefined, "viewing must not mutate an existing SSP");
  Object.assign(req, resolved);
  setSectionStatus(b, req, control, "b", "implemented", definitions);
  assert.equal(progress(req, control).status, "implemented");
  setProp(req, "completion-decision", "partial"); syncProgress(req, control);
  assert.equal(progress(req, control).status, "partial");
  setProp(req, "completion-decision", "implemented"); syncProgress(req, control);
  assert.equal(progress(req, control).status, "implemented");
  setSectionStatus(b, req, control, "b", "not-set", definitions);
  assert.equal(progress(req, control).status, "partial", "reopening revokes completion confirmation");
  contribution.props[0].value = "implemented";
  setSectionStatus(b, req, control, "b", "component:" + component.uuid, definitions);
  assert.equal(progress(req, control).status, "component");
  removeComponent(b, component.uuid, [{ control }]);
  assert.equal(progress(req, control).status, "not-set");
  assert.ok(req.statements!.every((s: any) => !s["by-components"]));
});
test("unknown component coverage is partial and invalid component references are rejected", () => {
  const { b, req, control, component, contribution, definitions } = fixture();
  delete contribution.props;
  setSectionStatus(b, req, control, "a", "component:" + component.uuid, definitions);
  assert.equal(progress(req, control).status, "partial");
  assert.throws(() => setSectionStatus(b, req, control, "b", "component:missing", definitions), /contributing/);
  assert.throws(() => setSectionStatus(b, req, control, "missing", "implemented", definitions), /Unknown statement/);
});
test("editing narratives preserves section status and other component entries", () => {
  const { b, req, control, component, definitions, doc } = fixture();
  setSectionStatus(b, req, control, "a", "component:" + component.uuid, definitions);
  const s = req.statements[0], system = b["system-implementation"].components[0].uuid, id = s.uuid;
  setDescription(s, system, "The system completes the remaining work.");
  setDescription(s, system, "Revised implementation");
  setDescription(s, system, "");
  assert.equal(s.uuid, id);
  assert.equal(s["by-components"].length, 1);
  assert.equal(progress(req, control).status, "partial");
  assert.deepEqual(validate(doc), []);
});
test("all default roles can be removed with reference cleanup and custom roles remain schema valid", () => {
  const { b, doc, profile, req } = fixture();
  const party = "22222222-2222-4222-8222-222222222222";
  b.metadata.parties = [{ uuid: party, type: "person", name: "Operator" }];
  b.metadata["responsible-parties"] = b.metadata.roles.map((r: any) => ({ "role-id": r.id, "party-uuids": [party] }));
  req["responsible-roles"] = [{ "role-id": "senior-risk-owner" }];
  for (const role of [...b.metadata.roles]) removeRole(b, role.id);
  assert.equal(b.metadata.roles, undefined);
  assert.equal(req["responsible-roles"], undefined);
  assert.equal(b["system-implementation"].users[0]["role-ids"], undefined);
  assert.equal(b.metadata.parties.length, 1, "shared people are preserved");
  assert.deepEqual(validate(doc), []);
  const role = addRole(b, "Custom <security> lead");
  assert.match(role.id, /^role-/);
  assert.throws(() => addRole(b, "custom <security> lead"), /already exists/);
  assert.deepEqual(integrity(doc, profile, "release"), []);
});
test("cards filter by group and case-insensitive multi-term search; read-only controls stay disabled", () => {
  const { b, profile, definitions } = fixture();
  const rows = flatten(profile.resolved.catalog) as any[];
  assert.equal(filterControls(rows, "ac", " AC-1 POLICY ").length, 1);
  assert.equal(filterControls(rows, "ir", "policy").length, 0);
  assert.equal(filterControls(rows, "", "not present").length, 0);
  const html = renderControlCards(b, rows, definitions, false, new Set(["ac-1"]));
  assert.match(html, /data-control-card="ac-1"/);
  assert.match(html, /data-section-status="a"[^>]*disabled/);
  assert.doesNotMatch(html, /data-parameter|control-select/);
  assert.ok(statementParts(rows[0].control).length === 2);
});
