import {
  CosmosClient,
  type Container,
  type OperationInput,
} from "@azure/cosmos";
import { DefaultAzureCredential } from "@azure/identity";
import type {
  Repository,
  Ssp,
  User,
  Json,
  ContentStore,
  Release,
} from "../shared/types";
import { security } from "./authz";
import { ApiError } from "./errors";
import { hash } from "./digest";
export const cosmos = () =>
  new CosmosClient({
    endpoint: process.env.COSMOS_ENDPOINT!,
    aadCredentials: new DefaultAzureCredential(),
  });
export class CosmosRepository implements Repository {
  constructor(public container: Container) {}
  async get(id: string) {
    try {
      return (await this.container.item("current", id).read<Ssp>()).resource;
    } catch (e: any) {
      if (e.code === 404) return undefined;
      throw e;
    }
  }
  async list(u: User) {
    const query = security(u)
      ? 'SELECT * FROM c WHERE c.id = "current" AND c.tenantId = @tid'
      : 'SELECT * FROM c WHERE c.id = "current" AND c.tenantId = @tid AND (c.ownerId = @oid OR EXISTS(SELECT VALUE a FROM a IN c.access WHERE a.oid = @oid))';
    const { resources } = await this.container.items
      .query<Ssp>({
        query,
        parameters: [
          { name: "@tid", value: u.tid },
          ...(!security(u) ? [{ name: "@oid", value: u.oid }] : []),
        ],
      })
      .fetchAll();
    return resources;
  }
  async create(s: Ssp, r: Json, a: Json) {
    await this.batch(
      s.sspId,
      [s, r, a].map((resourceBody) => ({
        operationType: "Create",
        resourceBody: JSON.parse(JSON.stringify(resourceBody)),
      })),
    );
  }
  async commit(previous: Ssp, next: Ssp, records: Json[]) {
    const { _etag, ...clean } = next;
    await this.batch(next.sspId, [
      {
        operationType: "Replace",
        id: "current",
        resourceBody: JSON.parse(JSON.stringify(clean)),
        ifMatch: previous._etag,
      },
      ...records.map((resourceBody) => ({
        operationType: "Create" as const,
        resourceBody,
      })),
    ]);
  }
  async batch(id: string, operations: OperationInput[]) {
    const result = await this.container.items.batch(operations, id);
    const code =
      result.result?.find((r) => r.statusCode >= 400)?.statusCode ||
      result.code ||
      500;
    if (code >= 400) {
      if ([409, 412, 424].includes(code))
        throw new ApiError(409, "Concurrent update; reload");
      throw new ApiError(503, "Persistence unavailable");
    }
  }

  async records(id: string, prefix: string) {
    return (
      await this.container.items
        .query<Json>(
          {
            query:
              "SELECT * FROM c WHERE c.sspId = @id AND STARTSWITH(c.id, @prefix)",
            parameters: [
              { name: "@id", value: id },
              { name: "@prefix", value: prefix },
            ],
          },
          { partitionKey: id },
        )
        .fetchAll()
    ).resources;
  }
}
export class CosmosContent implements ContentStore {
  cache = new Map<string, Release>();
  constructor(public container: Container) {}
  async active() {
    const { resource } = await this.container.item("active", "index").read();
    if (!resource) throw new ApiError(503, "No approved content published");
    return this.get(resource.target);
  }
  async get(id: string) {
    if (this.cache.has(id)) return this.cache.get(id)!;
    const { resource: manifest } = await this.container
      .item("manifest", id)
      .read();
    if (!manifest) throw new ApiError(404, "Content release not found");
    const { resources } = await this.container.items
      .query<Json>(
        {
          query: 'SELECT * FROM c WHERE c.releaseId = @id AND c.kind = "chunk"',
          parameters: [{ name: "@id", value: id }],
        },
        { partitionKey: id },
      )
      .fetchAll();
    resources.sort((a, b) => a.index - b.index);
    if (resources.length !== manifest.chunks)
      throw new ApiError(503, "Incomplete content");
    const release = JSON.parse(
      Buffer.concat(
        resources.map((x) => Buffer.from(x.data, "base64")),
      ).toString("utf8"),
    );
    if (hash(release) !== manifest.hash)
      throw new ApiError(503, "Content integrity error");
    if (this.cache.size > 3) this.cache.clear();
    this.cache.set(id, release);
    return release;
  }
}

