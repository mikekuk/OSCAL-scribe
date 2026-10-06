import { test } from "node:test";
import assert from "node:assert/strict";
import type { Container, Database } from "@azure/cosmos";
import { CosmosRepository } from "../src/api/cosmos";
import { CosmosAdminStore } from "../src/api/cosmos-admin";
import { Service } from "../src/api/service";
import { boundedResponse } from "../src/api/security";
import type { ContentStore, User } from "../src/shared/types";

const user: User = { oid: "reader", tid: "tenant", roles: ["User"] };
function fixture(response: object, failure?: Error) {
  let calls = 0;
  const container = { items: { query: () => ({ fetchNext: async () => {
    calls++;
    if (failure) throw failure;
    return response;
  } }) } } as unknown as Container;
  const repo = new CosmosRepository(container);
  const admin = new CosmosAdminStore({ container: () => container } as unknown as Database);
  return { repo, calls: () => calls, queries: {
    plans: () => repo.list(user),
    adminPlans: () => repo.adminPage(user, "", "active"),
    history: () => repo.records("plan", "revision:"),
    partitions: () => admin.partitions(),
    raw: () => admin.raw("content", "release"),
  } };
}

// Cosmos fetchNext can return resources: undefined for an empty query page.
// Verify the serialized HTTP contract, where undefined properties disappear.
test("empty Cosmos plan results retain the items array in the login API response", async () => {
  const { repo } = fixture({ resources: undefined });
  const service = new Service(repo, {} as ContentStore);
  const response = JSON.parse(boundedResponse(await service.request(user, "GET", "/api/ssps")));
  assert.deepEqual(response, { items: [] });
  assert.equal(response.items.length, 0);
});

for (const name of Object.keys(fixture({}).queries) as (keyof ReturnType<typeof fixture>["queries"])[]) {
  test(`${name}: empty pages preserve cursors, populated pages preserve records, and failures propagate`, async () => {
    for (const resources of [undefined, [], [{ id: "example" }]]) {
      const f = fixture({ resources, continuationToken: "next-page" });
      const response = JSON.parse(boundedResponse(await f.queries[name]()));
      assert.deepEqual(response, { items: resources ?? [], cursor: "next-page" });
      assert.equal(f.calls(), 1, "do not fetch unbounded pages to find nonempty results");
    }
    const failure = new Error("Cosmos access denied");
    const f = fixture({}, failure);
    await assert.rejects(f.queries[name](), error => error === failure);
  });
}
