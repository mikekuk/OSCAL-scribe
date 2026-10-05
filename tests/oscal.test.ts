import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validate, bounded } from "../src/shared/validation";
import { createSsp, integrity, reviewStatus, statementParts } from "../src/shared/oscal";
import { flatten, preview } from "../src/shared/lens/engine.mjs";
test("small SOC example yields a valid SSP with exactly seven controls", async () => {
  const release = JSON.parse(
    await readFile("work/content-release.json", "utf8"),
  );
  assert.deepEqual(release.profiles.map((p: any) => p.id), ["soc-worked-example"]);
  for (const p of release.profiles) {
    const doc = createSsp("Example system", p, release.id);
    assert.deepEqual(validate(doc), []);
    assert.deepEqual(integrity(doc, p, release.id), []);
    assert.deepEqual(validate(p.resolved, 20_000_000), []);
    const source = release.sources.find((s: any) => s.path === p.path);
    const selected = source.doc.profile.imports.flatMap((i: any) =>
      i["include-controls"].flatMap((c: any) => c["with-ids"]),
    );
    assert.deepEqual(
      flatten(p.resolved.catalog)
        .map((r: any) => r.control.id)
        .sort(),
      selected.sort(),
    );
    assert.deepEqual(selected.sort(), ["au-12", "au-2", "au-6", "ir-4", "ir-5", "ir-6", "si-4"]);
  }
});
test("malicious depth, oversized data, unsupported versions and schema violations rejected", () => {
  let deep: any = {};
  for (let i = 0; i < 100; i++) deep = { next: deep };
  assert.throws(() => bounded(deep), /complexity/);
  assert.throws(() => bounded({ x: "x".repeat(1000001) }), /large/);
  assert.match(
    validate({ profile: { metadata: { "oscal-version": "9.9.9" } } })[0],
    /Unsupported/,
  );
});
test("Lens inherited profile applies exclusions, alterations and parameter changes deterministically", () => {
  const cat = {
      catalog: {
        controls: [
          {
            id: "a",
            title: "Original",
            params: [{ id: "p", label: "Frequency" }],
            parts: [{ id: "a_smt", name: "statement", prose: "Original text" }],
          },
          { id: "b", title: "Excluded" },
        ],
      },
    },
    inner = {
      profile: {
        imports: [{ href: "cat.json", "include-all": {} }],
        modify: {
          "set-parameters": [{ "param-id": "p", values: ["daily"] }],
          alters: [
            {
              "control-id": "a",
              removes: [{ "by-id": "a_smt" }],
              adds: [
                {
                  parts: [
                    { id: "a_new", name: "statement", prose: "Profile text" },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
    outer = {
      profile: {
        imports: [
          {
            href: "inner.json",
            "include-all": {},
            "exclude-controls": [{ "with-ids": ["b"] }],
          },
        ],
      },
    };
  const docs = [
      { name: "cat.json", path: "cat.json", doc: cat },
      { name: "inner.json", path: "inner.json", doc: inner },
      { name: "outer.json", path: "outer.json", doc: outer },
    ],
    r = preview(outer, docs);
  assert.deepEqual(
    r.rows.map((x: any) => x.control.id),
    ["a"],
  );
  assert.equal(r.rows[0].parameters.p.values[0], "daily");
  assert.equal(r.rows[0].control.parts[0].prose, "Profile text");
  assert.deepEqual(r, preview(outer, docs));
  assert.equal(cat.catalog.controls[0].title, "Original");
});
test("review states distinguish changed, due and overdue", () => {
  const s: any = {
    currentRevision: 2,
    lastAttestation: { revision: 2, due: "2026-10-20T00:00:00Z" },
  };
  assert.equal(reviewStatus(s, new Date("2026-10-02")), "Due within 30 days");
  assert.equal(reviewStatus(s, new Date("2026-11-02")), "Overdue");
  s.currentRevision = 3;
  assert.equal(reviewStatus(s), "Changed since attestation");
});

test("release and attestation digests ignore JSON object property order", async () => {
  const { hash } = await import("../src/api/service");
  assert.equal(
    hash({ b: 2, a: { y: 2, x: 1 } }),
    hash({ a: { x: 1, y: 2 }, b: 2 }),
  );
  assert.notEqual(hash({ a: [1, 2] }), hash({ a: [2, 1] }));
});

test("published demo preserves NIST statements and resolves every example ODP and nested context", async () => {
  const release = JSON.parse(await readFile("work/content-release.json", "utf8"));
  const p = release.profiles[0];
  const profile = release.sources.find((s: any) => s.path === p.path).doc.profile;
  const catalog = release.sources.find((s: any) => s.doc.catalog).doc.catalog;
  const rows = flatten(p.resolved.catalog) as any[];
  const original = flatten(catalog) as any[];
  for (const setting of profile.modify["set-parameters"]) {
    const matches = rows.filter(r => r.parameters[setting["param-id"]]);
    assert.equal(matches.length, 1, "ODP must belong to exactly one selected control");
    assert.deepEqual(matches[0].parameters[setting["param-id"]].values, setting.values);
  }
  for (const row of rows) {
    for (const parameter of Object.values(row.parameters) as any[])
      assert.ok(parameter.values?.length, parameter.id + " must have an example value");
    const before = statementParts(original.find(r => r.control.id === row.control.id).control);
    const after = statementParts(row.control);
    for (const part of before)
      assert.equal(after.find(x => x.id === part.id)?.prose, part.prose, "NIST prose remains intact");
  }
  const findPart = (parts: any[], id: string): any => {
    for (const part of parts) {
      if (part.id === id) return part;
      const nested = findPart(part.parts || [], id);
      if (nested) return nested;
    }
  };
  let additions = 0;
  for (const alter of profile.modify.alters) {
    const control = rows.find(r => r.control.id === alter["control-id"]).control;
    for (const add of alter.adds) {
      const target = findPart(control.parts, add["by-id"]);
      assert.ok(target, "context anchor must exist");
      for (const part of add.parts) {
        assert.equal(target.parts.find((x: any) => x.id === part.id)?.prose, part.prose);
        assert.ok(statementParts(control).some(x => x.id === part.id), "context appears in statement editor");
        additions++;
      }
    }
  }
  assert.equal(additions, 5);
  assert.deepEqual(rows.find(r => r.control.id === "ir-6").parameters["ir-06_odp.01"].values, ["one hour of discovery"]);
  assert.deepEqual(rows.find(r => r.control.id === "au-6").parameters["au-06_odp.01"].values, ["daily, with continuous triage of high-severity alerts"]);
  const component = release.components[0];
  assert.deepEqual(validate(component), []);
  const implementation = component["component-definition"].components[0]["control-implementations"][0];
  assert.equal(implementation.source, p.path);
  assert.deepEqual(implementation["implemented-requirements"].map((r: any) => r["control-id"]).sort(),
    ["au-2", "au-6", "ir-4", "ir-5", "si-4"]);
  for (const requirement of implementation["implemented-requirements"]) {
    assert.match(requirement.description, /example evidence/i);
    const parts = statementParts(rows.find(r => r.control.id === requirement["control-id"]).control);
    assert.ok(requirement.statements.every((s: any) => parts.some(p => p.id === s["statement-id"])), "only valid covered sections are published");
    for (const statement of requirement.statements) {
      assert.ok(statement.description.length > 40);
      assert.equal(statement.props.find((p: any) => p.name === "implementation-status").value, "implemented");
    }
  }
});

test("official Low and Moderate remain unchanged reference sources, not demo choices", async () => {
  const release = JSON.parse(await readFile("work/content-release.json", "utf8"));
  const sources = release.sources.map((s: any) => ({ ...s, name: s.path }));
  for (const [name, count] of [["LOW", 149], ["MODERATE", 287]] as const) {
    const source = sources.find((s: any) => s.path.includes(name + "-baseline"));
    assert.deepEqual(validate(source.doc, 20_000_000), []);
    assert.equal(preview(source.doc, sources).rows.length, count);
    assert.ok(!release.profiles.some((p: any) => p.path === source.path));
  }
});
