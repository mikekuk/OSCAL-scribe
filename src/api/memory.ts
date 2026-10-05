// Used only by automated tests and the explicit loopback demo server.
import type { Repository, Ssp, User, Json } from "../shared/types";
import { canRead, appAdmin } from "./authz";
import { ApiError } from "./service";
export class MemoryRepository implements Repository {
  current = new Map<string, Ssp>();
  history = new Map<string, Json[]>();
  async list(u: User) {
    return structuredClone(
      [...this.current.values()].filter((s) => canRead(u, s) || (appAdmin(u) && u.tid === s.tenantId)),
    );
  }
  async get(id: string) {
    return structuredClone(this.current.get(id));
  }
  async adminPage(user: User, query: string, state: string, cursor?: string) {
    const offset = Number(cursor || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ApiError(400, "Invalid page");
    const matches = [...this.current.values()].filter(s => s.tenantId === user.tid
      && (s.sspId.includes(query) || s.oscal["system-security-plan"].metadata.title.toLowerCase().includes(query.toLowerCase()))
      && (state === "all" || (state === "archived" && s.archived) || (state === "deleting" && s.deleting) || (state === "active" && !s.archived && !s.deleting)))
      .sort((a, b) => a.sspId.localeCompare(b.sspId));
    return { items: matches.slice(offset, offset + 25).map(s => ({ sspId: s.sspId, title: s.oscal["system-security-plan"].metadata.title, version: s.version, archived: s.archived, deleting: s.deleting })), cursor: offset + 25 < matches.length ? String(offset + 25) : undefined };
  }
  async create(s: Ssp, r: Json, a: Json) {
    if (this.current.has(s.sspId)) throw new ApiError(409, "Conflict");
    this.current.set(s.sspId, structuredClone(s));
    this.history.set(s.sspId, structuredClone([r, a]));
  }
  async commit(previous: Ssp, next: Ssp, records: Json[]) {
    if (this.current.get(previous.sspId)?.version !== previous.version)
      throw new ApiError(409, "Conflict");
    this.current.set(next.sspId, structuredClone(next));
    this.history.get(next.sspId)!.push(...structuredClone(records));
  }
  async purge(s: Ssp) {
    const current = this.current.get(s.sspId);
    if (!current || current.version !== s.version) throw new ApiError(409, "Conflict");
    this.current.delete(s.sspId);
    this.history.delete(s.sspId);
  }
  async records(id: string, prefix: string) {
    return structuredClone(
      (this.history.get(id) || []).filter((x) => x.id.startsWith(prefix)),
    );
  }
}
