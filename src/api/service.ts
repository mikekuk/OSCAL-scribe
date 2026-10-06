import { copyUploadedSsp } from "../shared/ssp-import";
import type { Directory } from "./directory";
import type { Person } from "../shared/types";
import { AdminService, MAX_UPLOAD, type AdminStore } from "./admin";
import { createHash, randomUUID } from "node:crypto";
import { canRead, canEdit, canShare, canAttest, canAdminister } from "./authz";
import { createSsp, integrity } from "../shared/oscal";
import { validate, bounded } from "../shared/validation";
import type {
  User,
  Release,
  Ssp,
  Repository,
  ContentStore,
  Json,
  Revision,
} from "../shared/types";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
export const hash = (doc: Json) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(doc)))
    .digest("hex");
const requireKeys = (body: Json, keys: string[]) => {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !keys.includes(k))
  )
    throw new ApiError(400, "Unexpected request fields");
};
export class Service {
  constructor(
    public repo: Repository,
    public content: ContentStore,
    public admin?: AdminStore,
    public directory?: Directory,
  ) {}
  async request(
    user: User | undefined,
    method: string,
    path: string,
    body: Json = {},
    match?: string,
  ): Promise<any> {
    if (!user) throw new ApiError(401, "Authentication required");
    if (!user.roles.some((r) => ["User", "Security", "AppAdmin"].includes(r)))
      throw new ApiError(403, "Application assignment required");
    try {
      bounded(body, user.roles.includes("AppAdmin") && /^\/?(?:api\/)?admin\/library\/?$/.test(path) ? MAX_UPLOAD + 1000 : 1_000_000);
    } catch (e) {
      throw new ApiError(413, (e as Error).message);
    }
    const p = path
      .replace(/^\/api\/?/, "")
      .split("/")
      .filter(Boolean);
    if (p[0] === "admin") {
      if (!user.roles.includes("AppAdmin")) throw new ApiError(403, "App Admin role required");
      if (!this.admin) throw new ApiError(503, "Administration storage is unavailable");
      return new AdminService(this.repo, this.admin).request(user, method, p.slice(1), body);
    }
    if (p[0] === "me" && method === "GET") return user;
    if (p[0] === "content" && method === "GET") {
      const release = p[1]
        ? await this.content.get(p[1])
        : await this.content.active();
      if (p[2]) {
        const profile = release.profiles.find((x) => x.id === p[2]);
        if (!profile) throw new ApiError(404, "Profile not found");
        return {
          releaseId: release.id,
          profile,
          components: release.components,
          sources: release.sources,
        };
      }
      return {
        id: release.id,
        demo: release.demo,
        profiles: release.profiles.map(({ id, title }) => ({ id, title })),
        components: release.components,
      };
    }
    if (p[0] !== "ssps") throw new ApiError(404, "Not found");
    if (p[1] === "import" && method === "POST" && (!p[2] || (p[2] === "preview" && !p[3]))) {
      requireKeys(body, ["oscal"]);
      const errors = validate(body.oscal || {});
      if (errors.length || !body.oscal?.["system-security-plan"]) throw new ApiError(422, "Upload a valid OSCAL SSP JSON file", errors);
      const source = body.oscal["system-security-plan"];
      const reference = /^urn:oscal-scribe:([a-zA-Z0-9_-]{1,100}):([a-zA-Z0-9_.-]{1,200})$/.exec(source["import-profile"].href);
      if (!reference) throw new ApiError(422, "This upload needs the original Scribe baseline reference. Use an SSP downloaded from Scribe; external profiles are not fetched.");
      let release: Release;
      try { release = await this.content.get(reference[1]); }
      catch (error) {
        if (error instanceof ApiError && error.status === 404) throw new ApiError(422, "The original content release is unavailable. An administrator must restore or publish that exact release before you can upload this SSP.");
        throw error;
      }
      const profile = release.profiles.find(p => p.id === reference[2]);
      if (!profile) throw new ApiError(422, "The original profile is not present in this content release");
      this.valid(body.oscal, profile, release.id);
      if (source["system-implementation"].components.filter((c: Json) => c.type === "this-system").length !== 1)
        throw new ApiError(422, "The SSP must contain exactly one this-system component");
      if (p[2] === "preview") return { title: source.metadata.title, systemName: source["system-characteristics"]["system-name"], profileTitle: profile.title || profile.id, releaseId: release.id, sourceUuid: source.uuid };
      const now = new Date().toISOString(), id = randomUUID(), oscal = copyUploadedSsp(body.oscal, id, now);
      this.valid(oscal, profile, release.id);
      const imported: Ssp = { id: "current", sspId: id, tenantId: user.tid, ownerId: user.oid, access: [], createdAt: now, createdBy: user.oid, modifiedAt: now, modifiedBy: user.oid, currentRevision: 1, version: 1, archived: false, releaseId: release.id, profileId: profile.id, oscal };
      // Always create a fresh private plan: file metadata cannot restore app ACLs,
      // impersonate an author, replace another SSP or restore an attestation.
      await this.repo.create(imported, this.revision(imported, await this.actorIdentity(user)), { ...this.audit(imported, user, "import"), sourceUuid: source.uuid, sourceHash: hash(body.oscal) });
      return imported;
    }
    if (!p[1]) {
      if (method === "GET")
        return (await this.repo.list(user)).filter(s => !s.deleting).map((s) => ({
          ...s,
          oscal: undefined,
          title: s.oscal["system-security-plan"].metadata.title,
          systemName:
            s.oscal["system-security-plan"]["system-characteristics"][
              "system-name"
            ],
        }));
      if (method !== "POST") throw new ApiError(405, "Method not allowed");
      requireKeys(body, ["releaseId", "profileId", "systemName"]);
      if (
        typeof body.systemName !== "string" ||
        body.systemName.trim().length < 1 ||
        body.systemName.length > 200
      )
        throw new ApiError(400, "System name required (1–200 characters)");
      const release = await this.content.active();
      if (body.releaseId !== release.id)
        throw new ApiError(409, "Select the current approved content release");
      const profile = release.profiles.find((x) => x.id === body.profileId);
      if (!profile) throw new ApiError(400, "Approved profile required");
      const oscal = createSsp(body.systemName.trim(), profile, release.id),
        now = new Date().toISOString();
      const s: Ssp = {
        id: "current",
        sspId: oscal["system-security-plan"].uuid,
        tenantId: user.tid,
        ownerId: user.oid,
        access: [],
        createdAt: now,
        createdBy: user.oid,
        modifiedAt: now,
        modifiedBy: user.oid,
        currentRevision: 1,
        version: 1,
        archived: false,
        releaseId: release.id,
        profileId: profile.id,
        oscal,
      };
      this.valid(oscal, profile, release.id);
      await this.repo.create(
        s,
        this.revision(s, await this.actorIdentity(user)),
        this.audit(s, user, "create"),
      );
      return s;
    }
    const s = await this.repo.get(p[1]);
    if (!s || !canRead(user, s)) throw new ApiError(404, "SSP not found");
    if (p[2] === "people" && method === "POST") {
      if (!canShare(user, s)) throw new ApiError(403, "Sharing permission required");
      requireKeys(body, ["query"]);
      if (!this.directory) throw new ApiError(503, "Directory lookup is unavailable");
      return this.directory.search(user.tid, body.query);
    }
    if (p[2] === "identities" && method === "POST") {
      requireKeys(body, ["ids"]);
      if (!Array.isArray(body.ids) || body.ids.length > 100 || body.ids.some((id: any) => typeof id !== "string")) throw new ApiError(400, "Request up to 100 participant IDs");
      const actors = await this.repo.revisionActors(s.sspId, body.ids);
      const allowed = new Set([s.ownerId, s.modifiedBy, s.lastAttestation?.actor, ...s.access.map(a => a.oid), ...actors]);
      if (body.ids.some((id: string) => !allowed.has(id))) throw new ApiError(403, "Only this plan’s participants can be resolved");
      const people: Person[] = [];
      let unavailable = false;
      // Bound Graph concurrency and response size even for a plan with many authors.
      const ids: string[] = [...new Set<string>(body.ids)];
      for (let index = 0; index < ids.length && !unavailable; index += 5) await Promise.all(ids.slice(index, index + 5).map(async id => {
        try { const person = await this.directory?.lookup(user.tid, id); if (person) people.push(person); if (!this.directory) unavailable = true; } catch { unavailable = true; }
      }));
      return { people, unavailable };
    }
    if (method === "GET") {
      if (!p[2]) return s;
      if (p[2] === "revisions") {
        const revisions = await this.repo.records(s.sspId, "revision:");
        if (p[3]) {
          const r = revisions.find((x) => String(x.revision) === p[3]);
          if (!r) throw new ApiError(404, "Revision not found");
          return r;
        }
        return revisions.map((r) => ({ ...r, oscal: undefined }));
      }
      if (p[2] === "attestations")
        return this.repo.records(s.sspId, "attestation:");
    }
    if (p[2] === "validate" && method === "POST") {
      requireKeys(body, ["oscal"]);
      const release = await this.content.get(s.releaseId),
        profile = release.profiles.find((x) => x.id === s.profileId)!;
      const doc = body.oscal || s.oscal;
      return {
        errors: [...validate(doc), ...integrity(doc, profile, release.id)],
      };
    }
    const operation = p[2] || "update";
    const permission =
      operation === "update"
        ? canEdit
        : operation === "share"
          ? canShare
          : operation === "attest"
            ? canAttest
            : operation === "archive"
              ? canAdminister
              : undefined;
    if (!permission || !permission(user, s))
      throw new ApiError(403, "Operation not permitted");
    if (match !== String(s.version))
      throw new ApiError(409, "The SSP changed. Reload before saving.");
    const next = structuredClone(s),
      now = new Date().toISOString();
    next.version++;
    next.modifiedAt = now;
    next.modifiedBy = user.oid;
    const records: Json[] = [];
    if (operation === "update" && method === "PUT") {
      requireKeys(body, ["oscal"]);
      const release = await this.content.get(s.releaseId),
        profile = release.profiles.find((x) => x.id === s.profileId)!;
      if (body.oscal?.["system-security-plan"]?.uuid !== s.sspId)
        throw new ApiError(422, "SSP UUID cannot change");
      const document = structuredClone(body.oscal);
      if (!document?.["system-security-plan"]?.metadata)
        throw new ApiError(422, "SSP metadata required");
      document["system-security-plan"].metadata["last-modified"] = now;
      document["system-security-plan"].metadata.version = String(
        s.currentRevision + 1,
      );
      this.valid(document, profile, release.id);
      next.oscal = document;
      next.currentRevision++;
      records.push(this.revision(next, await this.actorIdentity(user)));
    } else if (operation === "share" && method === "POST") {
      requireKeys(body, ["oid", "permission"]);
      if (
        !/^[0-9a-f-]{36}$/i.test(body.oid) ||
        !["read", "edit", "remove"].includes(body.permission)
      )
        throw new ApiError(
          400,
          "Entra object ID and read/edit/remove permission required",
        );
      next.access = next.access.filter((x) => x.oid !== body.oid);
      if (body.permission !== "remove") {
        if (!this.directory) throw new ApiError(503, "Directory lookup is unavailable");
        // Revalidate the selected ID against the tenant at commit time, not a client label/cache.
        if (!await this.directory.lookup(user.tid, body.oid, true)) throw new ApiError(400, "This person is no longer available in the tenant");
        next.access.push({ oid: body.oid, permission: body.permission });
      }
      if (next.access.length > 100)
        throw new ApiError(400, "Maximum 100 sharing entries");
    } else if (operation === "archive" && method === "POST") {
      requireKeys(body, []);
      next.archived = true;
    } else if (operation === "attest" && method === "POST") {
      requireKeys(body, ["revision", "systemRole"]);
      if (body.revision !== s.currentRevision)
        throw new ApiError(409, "Attest the current saved revision");
      const b = s.oscal["system-security-plan"];
      // Roles belong to the saved revision. Default role names are templates,
      // not a fixed authorization policy; deleting SSO/SRO must not block attest.
      const systemRoles = b.metadata.roles || [];
      if (!systemRoles.some((r: Json) => r.id === body.systemRole))
        throw new ApiError(400, "Select a role defined in this saved plan");
      if (systemRoles.some((role: Json) => !b.metadata["responsible-parties"]?.some(
        (r: Json) => r["role-id"] === role.id && r["party-uuids"]?.length,
      ))) throw new ApiError(422, "Assign a person to each current system role before attestation");
      const date = new Date(now);
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      const a = {
        id: "attestation:" + randomUUID(),
        sspId: s.sspId,
        revision: s.currentRevision,
        actor: user.oid,
        actorIdentity: await this.actorIdentity(user),
        systemRole: body.systemRole,
        at: now,
        due: date.toISOString(),
        hash: hash(s.oscal),
      };
      next.lastAttestation = a;
      records.push(a);
    } else throw new ApiError(405, "Method not allowed");
    records.push(this.audit(next, user, operation));
    await this.repo.commit(s, next, records);
    return next;
  }
  valid(doc: Json, profile: any, releaseId: string) {
    const errors = validate(doc);
    if (!errors.length) errors.push(...integrity(doc, profile, releaseId));
    if (errors.length)
      throw new ApiError(422, "OSCAL validation failed", errors);
  }
  // A snapshot is display metadata only. Immutable IDs remain the audit and ACL keys.
  private async actorIdentity(user: User): Promise<Person | undefined> {
    try { const person = await this.directory?.lookup(user.tid, user.oid); if (person) return person; } catch { /* A directory outage must not prevent saving a plan. */ }
    const displayName = user.displayName || user.email || user.userPrincipalName;
    return displayName ? { oid: user.oid, displayName, ...(user.email ? { email: user.email } : {}), ...(user.userPrincipalName ? { userPrincipalName: user.userPrincipalName } : {}) } : undefined;
  }
  revision(s: Ssp, actorIdentity?: Person): Revision {
    return {
      id: "revision:" + s.currentRevision,
      sspId: s.sspId,
      revision: s.currentRevision,
      actor: s.modifiedBy,
      ...(actorIdentity ? { actorIdentity } : {}),
      at: s.modifiedAt,
      releaseId: s.releaseId,
      profileId: s.profileId,
      hash: hash(s.oscal),
      oscal: structuredClone(s.oscal),
    };
  }
  audit(s: Ssp, u: User, event: string) {
    return {
      id: "audit:" + randomUUID(),
      sspId: s.sspId,
      event,
      actor: u.oid,
      at: new Date().toISOString(),
      revision: s.currentRevision,
    };
  }
}
