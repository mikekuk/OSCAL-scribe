import { AdminService, MAX_UPLOAD, type AdminStore } from "./admin";
import { createHash, randomUUID } from "node:crypto";
import { canRead, canEdit, canShare, canAttest, canAdminister } from "./authz";
import { createSsp, integrity } from "../shared/oscal";
import { validate, bounded } from "../shared/validation";
import type {
  User,
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
        this.revision(s),
        this.audit(s, user, "create"),
      );
      return s;
    }
    const s = await this.repo.get(p[1]);
    if (!s || !canRead(user, s)) throw new ApiError(404, "SSP not found");
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
      records.push(this.revision(next));
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
      if (body.permission !== "remove")
        next.access.push({ oid: body.oid, permission: body.permission });
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
  revision(s: Ssp): Revision {
    return {
      id: "revision:" + s.currentRevision,
      sspId: s.sspId,
      revision: s.currentRevision,
      actor: s.modifiedBy,
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
