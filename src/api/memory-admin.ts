// In-memory adapter for automated tests and the explicitly enabled loopback demo.
import type { AdminStore, Library } from "./admin";
import type { Json, Release } from "../shared/types";
import type { MemoryRepository } from "./memory";
import { ApiError } from "./service";
export class MemoryAdminStore implements AdminStore {
  state: Library = { entries: [], version: 0 };
  docs = new Map<string, Json>();
  events: Json[] = [];
  constructor(private repo: MemoryRepository, private release: Release) {}
  async library() { return structuredClone(this.state); }
  async saveLibrary(before: Library, after: Library) {
    if (before.version !== this.state.version) throw new ApiError(409, "Library changed; reload");
    this.state = structuredClone(after);
  }
  async putAsset(id: string, doc: Json) { this.docs.set(id, structuredClone(doc)); }
  async asset(id: string) { return structuredClone(this.docs.get(id)!); }
  async deleteAsset(id: string) { this.docs.delete(id); }
  async partitions(query = "", cursor?: string) {
    const items = ["library", "admin-audit", this.release.id, ...[...this.docs.keys()].map(id => "asset:" + id)].filter(id => id.includes(query)).sort();
    const offset = Number(cursor || 0);
    return { items: items.slice(offset, offset + 25), cursor: offset + 25 < items.length ? String(offset + 25) : undefined };
  }
  async audit(event: Json) { this.events.push(structuredClone(event)); }
  async raw(container: "ssps" | "content", partition: string, cursor?: string, query = "") {
    const offset = Number(cursor || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ApiError(400, "Invalid page");
    const all = container === "ssps" ? [await this.repo.get(partition), ...(this.repo.history.get(partition) || [])].filter(Boolean)
      : partition === "library" ? [this.state] : partition === "admin-audit" ? this.events
        : partition === this.release.id ? [this.release] : this.docs.has(partition.slice(6)) ? [this.docs.get(partition.slice(6))!] : [];
    const items = all.filter((r: any) => String(r.id || "registry").includes(query));
    return { items: structuredClone(items.slice(offset, offset + 10)) as Json[], cursor: offset + 10 < items.length ? String(offset + 10) : undefined };
  }
}
