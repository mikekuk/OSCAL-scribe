import type { Database } from "@azure/cosmos";
import { ApiError } from "./service";
import type { AdminStore, Library } from "./admin";
import type { Json } from "../shared/types";
/** No client-supplied query text or container names reach the database. */
export class CosmosAdminStore implements AdminStore {
  constructor(private db: Database) {}
  private get content() { return this.db.container("staging"); }
  async library(): Promise<Library> {
    try {
      const { resource } = await this.content.item("registry", "library").read();
      return resource || { entries: [], version: 0 };
    } catch (e: any) { if (e.code === 404) return { entries: [], version: 0 }; throw e; }
  }
  async saveLibrary(previous: Library, next: Library) {
    const resourceBody = { id: "registry", releaseId: "library", entries: next.entries, version: next.version };
    try {
      if (previous._etag) await this.content.item("registry", "library").replace(resourceBody, { accessCondition: { type: "IfMatch", condition: previous._etag } });
      else await this.content.items.create(resourceBody);
    } catch (e: any) { if ([409, 412].includes(e.code)) throw new ApiError(409, "Library changed; reload and retry"); throw e; }
  }
  async putAsset(id: string, doc: Json) {
    const bytes = Buffer.from(JSON.stringify(doc)), releaseId = "asset:" + id;
    let chunks = 0;
    for (let start = 0; start < bytes.length; start += 500000) {
      await this.content.items.create({ id: "chunk:" + chunks, releaseId, index: chunks++, data: bytes.subarray(start, start + 500000).toString("base64") });
    }
    await this.content.items.create({ id: "manifest", releaseId, chunks });
  }
  async asset(id: string) {
    const releaseId = "asset:" + id;
    const { resource } = await this.content.item("manifest", releaseId).read();
    const { resources } = await this.content.items.query<Json>({ query: 'SELECT * FROM c WHERE c.releaseId = @id AND STARTSWITH(c.id, "chunk:")', parameters: [{ name: "@id", value: releaseId }] }, { partitionKey: releaseId }).fetchAll();
    if (!resource || resources.length !== resource.chunks) throw new ApiError(503, "Incomplete library document");
    resources.sort((a, b) => a.index - b.index);
    return JSON.parse(Buffer.concat(resources.map(r => Buffer.from(r.data, "base64"))).toString("utf8"));
  }
  async deleteAsset(id: string) {
    const releaseId = "asset:" + id;
    const { resources } = await this.content.items.query<Json>({ query: "SELECT c.id FROM c WHERE c.releaseId = @id", parameters: [{ name: "@id", value: releaseId }] }, { partitionKey: releaseId }).fetchAll();
    for (const r of resources) await this.content.item(r.id, releaseId).delete();
  }
  async partitions(query = "", cursor?: string) {
    // ORDER BY is required for resumable DISTINCT queries across partitions.
    const result = await this.db.container("content").items.query<string>({ query: "SELECT DISTINCT VALUE c.releaseId FROM c WHERE CONTAINS(c.releaseId, @query) ORDER BY c.releaseId", parameters: [{ name: "@query", value: query }] }, { maxItemCount: 25, continuationToken: cursor }).fetchNext();
    // Empty Cosmos pages can omit resources; keep the JSON page contract intact.
    return { items: result.resources ?? [], cursor: result.continuationToken || undefined };
  }
  async raw(container: "ssps" | "content", partition: string, cursor?: string, query = "") {
    const key = container === "ssps" ? "sspId" : "releaseId";
    const result = await this.db.container(container).items.query<Json>({ query: `SELECT * FROM c WHERE c.${key} = @partition AND CONTAINS(c.id, @query) ORDER BY c.id`, parameters: [{ name: "@partition", value: partition }, { name: "@query", value: query }] }, { partitionKey: partition, maxItemCount: 1, continuationToken: cursor }).fetchNext();
    return { items: result.resources ?? [], cursor: result.continuationToken || undefined };
  }
  async audit(event: Json) { await this.db.container("audit").items.create(event); }
}
