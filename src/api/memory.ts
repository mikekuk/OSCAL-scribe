// Used only by automated tests and the explicit loopback demo server.
import type { Repository, Ssp, User, Json } from "../shared/types";
import { canRead } from "./authz";
import { ApiError } from "./errors";
export class MemoryRepository implements Repository {
  current = new Map<string, Ssp>();
  history = new Map<string, Json[]>();
  async list(u: User) {
    return structuredClone(
      [...this.current.values()].filter((s) => canRead(u, s)),
    );
  }
  async get(id: string) {
    return structuredClone(this.current.get(id));
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
  async records(id: string, prefix: string) {
    return structuredClone(
      (this.history.get(id) || []).filter((x) => x.id.startsWith(prefix)),
    );
  }
}

