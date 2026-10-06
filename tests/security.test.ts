import { test } from "node:test";
import assert from "node:assert/strict";
import { Service, ApiError } from "../src/api/service";
import { MemoryRepository } from "../src/api/memory";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
import { authenticator } from "../src/api/auth";
import type { User, Release } from "../src/shared/types";
const A: User = {
    oid: "11111111-1111-4111-8111-111111111111",
    tid: "33333333-3333-4333-8333-333333333333",
    roles: ["User"],
  },
  B: User = { ...A, oid: "22222222-2222-4222-8222-222222222222" },
  security: User = { ...B, roles: ["Security"] };
const release: Release = {
  id: "test",
  demo: false,
  sources: [],
  components: [],
  provenance: {},
  profiles: [
    {
      id: "low",
      title: "Low",
      path: "low.json",
      resolved: {
        catalog: {
          controls: [
            {
              id: "ac-1",
              title: "Policy",
              parts: [
                {
                  id: "ac-1_smt",
                  name: "statement",
                  prose: "Maintain policy.",
                },
              ],
            },
          ],
        },
      },
    },
  ],
};
async function fixture() {
  const repo = new MemoryRepository(),
    s = new Service(repo, {
      active: async () => release,
      get: async () => release,
    }, undefined, { lookup: async (_tenant, oid) => ({ oid, displayName: "Test person" }), search: async () => [] }),
    doc = await s.request(B, "POST", "/api/ssps", {
      releaseId: "test",
      profileId: "low",
      systemName: "Private system",
    });
  return { s, repo, doc, path: "/api/ssps/" + doc.sspId };
}
const denied = (p: Promise<any>, status: number) =>
  assert.rejects(p, (e: any) => e instanceof ApiError && e.status === status);
test("BOLA: guessing UUID grants no current, historical, validation, edit, share, archive or attestation access", async () => {
  const { s, doc, path } = await fixture();
  for (const [method, suffix, body] of [
    ["GET", "", {}],
    ["GET", "/revisions", {}],
    ["GET", "/revisions/1", {}],
    ["GET", "/attestations", {}],
    ["POST", "/validate", {}],
    ["PUT", "", { oscal: doc.oscal }],
    ["POST", "/share", { oid: A.oid, permission: "edit" }],
    ["POST", "/archive", {}],
    ["POST", "/attest", { revision: 1, systemRole: "ssp-preparer" }],
  ] as const)
    await denied(s.request(A, method, path + suffix, body, "1"), 404);
  assert.deepEqual((await s.request(A, "GET", "/api/ssps")).items, []);
});
test("read share cannot edit/manage; edit share can save only OSCAL", async () => {
  const { s, doc, path } = await fixture();
  await s.request(
    B,
    "POST",
    path + "/share",
    { oid: A.oid, permission: "read" },
    "1",
  );
  assert.equal((await s.request(A, "GET", path)).sspId, doc.sspId);
  await denied(s.request(A, "PUT", path, { oscal: doc.oscal }, "2"), 403);
  await s.request(
    B,
    "POST",
    path + "/share",
    { oid: A.oid, permission: "edit" },
    "2",
  );
  const saved = await s.request(A, "PUT", path, { oscal: doc.oscal }, "3");
  assert.equal(saved.currentRevision, 2);
  for (const op of ["share", "attest", "archive"])
    await denied(s.request(A, "POST", path + "/" + op, {}, "4"), 403);
  await denied(
    s.request(A, "PUT", path, { oscal: doc.oscal, ownerId: A.oid }, "4"),
    400,
  );
});
test("Security has global access only in its tenant; ordinary clients cannot manufacture privilege", async () => {
  const { s, doc, path } = await fixture();
  assert.equal((await s.request(security, "GET", path)).sspId, doc.sspId);
  assert.equal((await s.request(security, "GET", "/api/ssps")).items.length, 1);
  await denied(s.request({ ...security, tid: "other" }, "GET", path), 404);
  await denied(s.request(A, "PUT", path, { roles: ["Security"] }, "1"), 404);
  await denied(s.request(undefined, "GET", path), 401);
});
test("mass assignment, invalid baseline, malformed documents and conflicts rejected; old revisions immutable", async () => {
  const { s, doc, path } = await fixture();
  await denied(
    s.request(B, "POST", "/api/ssps", {
      releaseId: "test",
      profileId: "low",
      systemName: "x",
      ownerId: A.oid,
    }),
    400,
  );
  const edited = structuredClone(doc.oscal);
  edited["system-security-plan"]["system-characteristics"]["system-name"] =
    "Revised";
  const saved = await s.request(B, "PUT", path, { oscal: edited }, "1");
  assert.equal(saved.currentRevision, 2);
  assert.equal(
    (await s.request(B, "GET", path + "/revisions/1")).oscal[
      "system-security-plan"
    ]["system-characteristics"]["system-name"],
    "Private system",
  );
  await denied(s.request(B, "PUT", path, { oscal: edited }, "1"), 409);
  const bad = structuredClone(edited);
  bad["system-security-plan"]["control-implementation"][
    "implemented-requirements"
  ][0]["control-id"] = "fake";
  await denied(s.request(B, "PUT", path, { oscal: bad }, "2"), 422);
  await denied(s.request(B, "PUT", path, { oscal: { bad: true } }, "2"), 422);
});
test("revoked sharing blocks historical access immediately", async () => {
  const { s, path } = await fixture();
  await s.request(
    B,
    "POST",
    path + "/share",
    { oid: A.oid, permission: "read" },
    "1",
  );
  assert.equal((await s.request(A, "GET", path + "/revisions")).items.length, 1);
  await s.request(
    B,
    "POST",
    path + "/share",
    { oid: A.oid, permission: "remove" },
    "2",
  );
  await denied(s.request(A, "GET", path + "/revisions/1"), 404);
});
test("attestation pins a digest/revision; subsequent edits do not alter it", async () => {
  const { s, doc, path } = await fixture();
  const b = doc.oscal["system-security-plan"];
  const party = "44444444-4444-4444-8444-444444444444";
  b.metadata.parties = [
    { uuid: party, type: "person", name: "Demo accountable person" },
  ];
  b.metadata["responsible-parties"] = b.metadata.roles.map((r: any) => ({
    "role-id": r.id,
    "party-uuids": [party],
  }));
  await s.request(B, "PUT", path, { oscal: doc.oscal }, "1");
  const attested = await s.request(
    B,
    "POST",
    path + "/attest",
    { revision: 2, systemRole: "senior-risk-owner" },
    "2",
  );
  assert.equal(attested.lastAttestation.revision, 2);
  assert.equal(attested.lastAttestation.hash.length, 64);
  const next = await s.request(B, "PUT", path, { oscal: attested.oscal }, "3");
  assert.equal(next.currentRevision, 3);
  assert.deepEqual(next.lastAttestation, attested.lastAttestation);
  await s.request(B, "POST", path + "/archive", {}, "4");
  await denied(s.request(B, "PUT", path, { oscal: next.oscal }, "5"), 403);
});
test("JWT trust boundary: signature, audience, tenant, scope, expiry and role are mandatory", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const key = await exportJWK(publicKey);
  key.kid = "test";
  const auth = authenticator(A.tid, "app", createLocalJWKSet({ keys: [key] }));
  const token = async (overrides: any = {}) =>
    new SignJWT({
      oid: A.oid,
      tid: A.tid,
      roles: ["User"],
      scp: "access_as_user",
      ...overrides,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuedAt()
      .setIssuer(`https://login.microsoftonline.com/${A.tid}/v2.0`)
      .setAudience("app")
      .setExpirationTime("5m")
      .sign(privateKey);
  assert.deepEqual(await auth("Bearer " + (await token())), A);
  assert.deepEqual((await auth("Bearer " + (await token({ roles: ["AppAdmin"] })))).roles, ["AppAdmin"]);
  await assert.rejects(auth(undefined));
  for (const p of [
    { tid: "wrong" },
    { scp: "" },
    { roles: ["Senior Risk Owner"] },
  ])
    await assert.rejects(auth("Bearer " + (await token(p))));
  const good = await token();
  await assert.rejects(auth("Bearer " + good.slice(0, -8) + "tampered"));
  const wrongAud = authenticator(
    A.tid,
    "other-app",
    createLocalJWKSet({ keys: [key] }),
  );
  await assert.rejects(wrongAud("Bearer " + good));
});


test("attestation follows custom roles after deleting SSO and SRO", async () => {
  const { removeRole, addRole } = await import("../src/shared/implementation");
  const { s, doc, path } = await fixture();
  const b = doc.oscal["system-security-plan"];
  for (const role of [...b.metadata.roles]) removeRole(b, role.id);
  const role = addRole(b, "Service owner");
  const party = "55555555-5555-4555-8555-555555555555";
  b.metadata.parties = [{ uuid: party, type: "person", name: "Accountable owner" }];
  b.metadata["responsible-parties"] = [{ "role-id": role.id, "party-uuids": [party] }];
  await s.request(B, "PUT", path, { oscal: doc.oscal }, "1");
  await denied(s.request(B, "POST", path + "/attest", { revision: 2, systemRole: "senior-risk-owner" }, "2"), 400);
  const attested = await s.request(B, "POST", path + "/attest", { revision: 2, systemRole: role.id }, "2");
  assert.equal(attested.lastAttestation.systemRole, role.id);
});

test("attestation requires assignments for the current roles, not deleted defaults", async () => {
  const { removeRole, addRole } = await import("../src/shared/implementation");
  const { s, doc, path } = await fixture();
  const b = doc.oscal["system-security-plan"];
  for (const role of [...b.metadata.roles]) removeRole(b, role.id);
  const role = addRole(b, "Service owner");
  await s.request(B, "PUT", path, { oscal: doc.oscal }, "1");
  await denied(s.request(B, "POST", path + "/attest", { revision: 2, systemRole: role.id }, "2"), 422);
});
