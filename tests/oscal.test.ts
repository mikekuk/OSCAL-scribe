import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validate, bounded } from "../src/shared/validation";
import { createSsp, integrity, reviewStatus } from "../src/shared/oscal";
import { flatten, preview } from "../src/shared/lens/engine.mjs";
test("actual NIST Low and Moderate yield valid SSPs with exact control coverage", async () => {
  const release = JSON.parse(
    await readFile("work/content-release.json", "utf8"),
  );
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
    assert.ok(selected.length > 100);
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
